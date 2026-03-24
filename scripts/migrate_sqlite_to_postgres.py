import argparse
import sqlite3
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psycopg  # type: ignore
except Exception:
    psycopg = None

try:
    import psycopg2  # type: ignore
    from psycopg2.extras import execute_values  # type: ignore
except Exception:
    psycopg2 = None
    execute_values = None


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def get_sqlite_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows if str(row[0]) != "_prisma_migrations"]


def get_fk_dependencies(conn: sqlite3.Connection, tables: list[str]) -> dict[str, set[str]]:
    deps: dict[str, set[str]] = {table: set() for table in tables}
    table_set = set(tables)
    for table in tables:
        fk_rows = conn.execute(f"PRAGMA foreign_key_list({qi(table)})").fetchall()
        for fk in fk_rows:
            parent_table = str(fk[2])
            if parent_table in table_set and parent_table != table:
                deps[table].add(parent_table)
    return deps


def topo_sort_tables(deps: dict[str, set[str]]) -> list[str]:
    in_degree = {table: len(parents) for table, parents in deps.items()}
    reverse_graph: dict[str, set[str]] = defaultdict(set)
    for table, parents in deps.items():
        for parent in parents:
            reverse_graph[parent].add(table)

    queue = deque(sorted([table for table, degree in in_degree.items() if degree == 0]))
    order: list[str] = []
    while queue:
        table = queue.popleft()
        order.append(table)
        for child in sorted(reverse_graph.get(table, set())):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(order) != len(deps):
        remaining = [table for table in deps.keys() if table not in set(order)]
        order.extend(sorted(remaining))
    return order


def parse_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "y"}:
        return True
    if text in {"0", "false", "f", "no", "n"}:
        return False
    return None


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("T", " ").replace("Z", "")
    for fmt in [
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]:
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def normalize_value(value: Any, udt_name: str) -> Any:
    if value is None:
        return None
    udt = udt_name.lower()
    if udt in {"bool", "boolean"}:
        parsed = parse_bool(value)
        return parsed if parsed is not None else False
    if udt in {"timestamp", "timestamptz", "date"}:
        parsed = parse_datetime(value)
        return parsed if parsed is not None else None
    if udt in {"int2", "int4", "int8"}:
        try:
            return int(value)
        except Exception:
            return 0
    if udt in {"float4", "float8", "numeric"}:
        try:
            return float(value)
        except Exception:
            return 0
    return value


def normalize_cell_for_insert(column_name: str, value: Any, udt_name: str) -> Any:
    normalized = normalize_value(value, udt_name)
    if normalized is not None:
        return normalized
    if column_name in {"createdAt", "updatedAt", "created_at", "updated_at"}:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return None


def load_pg_columns_with_psycopg3(conn: Any, table: str) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )
        rows = cur.fetchall()
    return [(str(row[0]), str(row[1])) for row in rows]


def load_pg_columns_with_psycopg2(conn: Any, table: str) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )
        rows = cur.fetchall()
    return [(str(row[0]), str(row[1])) for row in rows]


def table_exists_with_psycopg3(conn: Any, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS(
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND lower(table_name) = lower(%s)
            )
            """,
            (table,),
        )
        row = cur.fetchone()
    return row is not None and bool(row[0])


def table_exists_with_psycopg2(conn: Any, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS(
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND lower(table_name) = lower(%s)
            )
            """,
            (table,),
        )
        row = cur.fetchone()
    return row is not None and bool(row[0])


def batch_rows(items: list[Any], size: int) -> list[list[Any]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]


def run_with_psycopg3(sqlite_path: Path, pg_url: str, batch_size: int) -> None:
    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    pg_conn = psycopg.connect(pg_url)
    try:
        tables = get_sqlite_tables(sqlite_conn)
        deps = get_fk_dependencies(sqlite_conn, tables)
        ordered_tables = topo_sort_tables(deps)

        target_tables: list[str] = [table for table in ordered_tables if table_exists_with_psycopg3(pg_conn, table)]
        if not target_tables:
            raise RuntimeError("PostgreSQL 中未找到可写入表，请先执行 Prisma db push")

        with pg_conn.cursor() as cur:
            truncate_sql = "TRUNCATE " + ", ".join([f"{qi('public')}.{qi(table)}" for table in reversed(target_tables)]) + " CASCADE"
            cur.execute(truncate_sql)

        total_inserted = 0
        for table in target_tables:
            pg_cols = load_pg_columns_with_psycopg3(pg_conn, table)
            if not pg_cols:
                continue
            pg_col_map = {name: udt for name, udt in pg_cols}

            sqlite_rows = sqlite_conn.execute(f"SELECT * FROM {qi(table)}").fetchall()
            if not sqlite_rows:
                print(f"{table}: 0")
                continue

            sqlite_cols = [str(col) for col in sqlite_rows[0].keys()]
            common_cols = [col for col in sqlite_cols if col in pg_col_map]
            if not common_cols:
                print(f"{table}: 0")
                continue

            insert_sql = (
                f"INSERT INTO {qi('public')}.{qi(table)} ("
                + ", ".join(qi(col) for col in common_cols)
                + ") VALUES ("
                + ", ".join(["%s"] * len(common_cols))
                + ")"
            )

            normalized_rows: list[tuple[Any, ...]] = []
            for row in sqlite_rows:
                item = tuple(normalize_cell_for_insert(col, row[col], pg_col_map[col]) for col in common_cols)
                normalized_rows.append(item)

            for chunk in batch_rows(normalized_rows, batch_size):
                with pg_conn.cursor() as cur:
                    cur.executemany(insert_sql, chunk)

            inserted = len(normalized_rows)
            total_inserted += inserted
            print(f"{table}: {inserted}")

        pg_conn.commit()
        print(f"TOTAL: {total_inserted}")
    except Exception:
        pg_conn.rollback()
        raise
    finally:
        pg_conn.close()
        sqlite_conn.close()


def run_with_psycopg2(sqlite_path: Path, pg_url: str, batch_size: int) -> None:
    if execute_values is None:
        raise RuntimeError("psycopg2.extras.execute_values 不可用")
    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    pg_conn = psycopg2.connect(pg_url)
    try:
        tables = get_sqlite_tables(sqlite_conn)
        deps = get_fk_dependencies(sqlite_conn, tables)
        ordered_tables = topo_sort_tables(deps)

        target_tables: list[str] = [table for table in ordered_tables if table_exists_with_psycopg2(pg_conn, table)]
        if not target_tables:
            raise RuntimeError("PostgreSQL 中未找到可写入表，请先执行 Prisma db push")

        with pg_conn.cursor() as cur:
            truncate_sql = "TRUNCATE " + ", ".join([f"{qi('public')}.{qi(table)}" for table in reversed(target_tables)]) + " CASCADE"
            cur.execute(truncate_sql)

        total_inserted = 0
        for table in target_tables:
            pg_cols = load_pg_columns_with_psycopg2(pg_conn, table)
            if not pg_cols:
                continue
            pg_col_map = {name: udt for name, udt in pg_cols}

            sqlite_rows = sqlite_conn.execute(f"SELECT * FROM {qi(table)}").fetchall()
            if not sqlite_rows:
                print(f"{table}: 0")
                continue

            sqlite_cols = [str(col) for col in sqlite_rows[0].keys()]
            common_cols = [col for col in sqlite_cols if col in pg_col_map]
            if not common_cols:
                print(f"{table}: 0")
                continue

            insert_sql = (
                f"INSERT INTO {qi('public')}.{qi(table)} ("
                + ", ".join(qi(col) for col in common_cols)
                + ") VALUES %s"
            )

            normalized_rows: list[tuple[Any, ...]] = []
            for row in sqlite_rows:
                item = tuple(normalize_cell_for_insert(col, row[col], pg_col_map[col]) for col in common_cols)
                normalized_rows.append(item)

            for chunk in batch_rows(normalized_rows, batch_size):
                with pg_conn.cursor() as cur:
                    execute_values(cur, insert_sql, chunk)

            inserted = len(normalized_rows)
            total_inserted += inserted
            print(f"{table}: {inserted}")

        pg_conn.commit()
        print(f"TOTAL: {total_inserted}")
    except Exception:
        pg_conn.rollback()
        raise
    finally:
        pg_conn.close()
        sqlite_conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", required=True)
    parser.add_argument("--pg-url", required=True)
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite).resolve()
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite 文件不存在: {sqlite_path}")

    if psycopg is not None:
        run_with_psycopg3(sqlite_path, args.pg_url, args.batch_size)
        return
    if psycopg2 is not None:
        run_with_psycopg2(sqlite_path, args.pg_url, args.batch_size)
        return
    raise RuntimeError("未安装 psycopg 或 psycopg2，请先安装任一驱动")


if __name__ == "__main__":
    main()
