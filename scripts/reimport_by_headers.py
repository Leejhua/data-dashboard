import argparse
import csv
import sys
from pathlib import Path
import sqlite3
from datetime import datetime


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def normalize_cell(value: str | None):
    if value is None:
        return None
    text = value.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        text = text[1:-1].strip()
    if text.endswith('"') and text.count('"') % 2 == 1:
        text = text[:-1].strip()
    if text == "" or text.upper() == "NULL":
        return None
    return text


def normalize_by_type(value: str | None, col_type: str):
    text = normalize_cell(value)
    if text is None:
        return None

    normalized_type = (col_type or "").upper()

    if "BOOL" in normalized_type:
        lowered = text.lower()
        if lowered in ("1", "true", "t", "yes", "y"):
            return 1
        if lowered in ("0", "false", "f", "no", "n"):
            return 0
        return None

    if "INT" in normalized_type:
        try:
            return int(float(text))
        except ValueError:
            return None

    if "REAL" in normalized_type or "FLOA" in normalized_type or "DOUB" in normalized_type or "NUM" in normalized_type or "DEC" in normalized_type:
        try:
            return float(text)
        except ValueError:
            return None

    if "DATE" in normalized_type or "TIME" in normalized_type:
        candidate = text.replace("T", " ").replace("Z", "")
        try:
            datetime.fromisoformat(candidate)
            return candidate
        except ValueError:
            return None

    return text


def fetch_table_schema(conn: sqlite3.Connection, table: str) -> dict[str, dict[str, object]]:
    rows = conn.execute(f"PRAGMA table_info({qi(table)})").fetchall()
    return {
        row[1]: {
            "type": str(row[2] or "").upper(),
            "notnull": bool(row[3]),
            "default": row[4],
        }
        for row in rows
    }


def import_csv_to_table(conn: sqlite3.Connection, csv_path: Path, table: str) -> int:
    table_schema = fetch_table_schema(conn, table)
    table_columns = list(table_schema.keys())
    table_column_set = set(table_columns)
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return 0
        headers = [str(h).strip() for h in reader.fieldnames if h is not None]
        mapped_columns = [h for h in headers if h in table_column_set]
        if not mapped_columns:
            raise RuntimeError(f"{csv_path.name} 没有可映射到 {table} 的列")
        columns_sql = ", ".join(qi(c) for c in mapped_columns)
        placeholders = ", ".join(["?"] * len(mapped_columns))
        insert_sql = f"INSERT INTO {qi(table)} ({columns_sql}) VALUES ({placeholders})"
        imported = 0
        batch: list[tuple] = []
        for row in reader:
            values_list = []
            for col in mapped_columns:
                info = table_schema[col]
                value = normalize_by_type(row.get(col), str(info["type"]))
                if value is None:
                    if bool(info["notnull"]) and info["default"] is None:
                        col_type = str(info["type"])
                        if "INT" in col_type or "REAL" in col_type or "NUM" in col_type or "DEC" in col_type:
                            value = 0
                        elif "BOOL" in col_type:
                            value = 0
                        elif "DATE" in col_type or "TIME" in col_type:
                            value = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        else:
                            value = ""
                values_list.append(value)
            values = tuple(values_list)
            batch.append(values)
            if len(batch) >= 1000:
                conn.executemany(insert_sql, batch)
                imported += len(batch)
                batch.clear()
        if batch:
            conn.executemany(insert_sql, batch)
            imported += len(batch)
        return imported


def nullify_invalid_optional_foreign_keys(conn: sqlite3.Connection, tables: set[str]):
    for table in tables:
        schema = fetch_table_schema(conn, table)
        fk_rows = conn.execute(f"PRAGMA foreign_key_list({qi(table)})").fetchall()
        for fk in fk_rows:
            child_col = str(fk[3])
            parent_table = str(fk[2])
            parent_col = str(fk[4] or "id")
            if child_col not in schema:
                continue
            if bool(schema[child_col]["notnull"]):
                continue
            conn.execute(
                f"UPDATE {qi(table)} AS t "
                f"SET {qi(child_col)} = NULL "
                f"WHERE t.{qi(child_col)} IS NOT NULL "
                f"AND NOT EXISTS (SELECT 1 FROM {qi(parent_table)} p WHERE p.{qi(parent_col)} = t.{qi(child_col)})"
            )


def ensure_missing_warehouses(conn: sqlite3.Connection, tables: set[str]):
    if "Warehouse" not in tables:
        return
    source_tables = [name for name in ["InventoryItem", "InventoryStock", "InventoryReservation", "InventoryAllocation"] if name in tables]
    if not source_tables:
        return
    union_parts = [f"SELECT warehouseId AS wid FROM {qi(name)} WHERE warehouseId IS NOT NULL AND TRIM(warehouseId) <> ''" for name in source_tables]
    query = " UNION ".join(union_parts)
    missing_ids = conn.execute(
        f"SELECT src.wid FROM ({query}) src LEFT JOIN \"Warehouse\" w ON w.id = src.wid WHERE w.id IS NULL"
    ).fetchall()
    for row in missing_ids:
        wid = str(row[0])
        conn.execute(
            "INSERT INTO \"Warehouse\" (id, name, isDefault, createdAt, updatedAt) VALUES (?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (wid, f"Warehouse-{wid}"),
        )


def normalize_datetime_column(conn: sqlite3.Connection, table: str, column: str):
    conn.execute(
        f"""
        UPDATE {qi(table)}
        SET {qi(column)} = CASE
          WHEN datetime({qi(column)}) IS NULL THEN NULL
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ', datetime({qi(column)}))
        END
        WHERE {qi(column)} IS NOT NULL
        """
    )


def cleanup_online_order_noise(conn: sqlite3.Connection):
    conn.execute(
        """
        UPDATE "OnlineOrder"
        SET orderNo = RTRIM(orderNo, '"')
        WHERE orderNo IS NOT NULL AND TRIM(orderNo) <> ''
        """
    )
    conn.execute(
        """
        DELETE FROM "OnlineOrder"
        WHERE productName LIKE '%机审结果%'
          AND totalAmount IS NULL
          AND merchantName IS NULL
        """
    )


def repair_order_data(conn: sqlite3.Connection, tables: set[str]):
    if "Order" in tables:
        conn.execute(
            """
            UPDATE "Order"
            SET createdAt = COALESCE(
              datetime(createdAt),
              datetime(rentStartDate),
              datetime(completedAt),
              CURRENT_TIMESTAMP
            )
            """
        )
        normalize_datetime_column(conn, "Order", "createdAt")

        conn.execute(
            """
            UPDATE "Order"
            SET updatedAt = COALESCE(
              datetime(updatedAt),
              datetime(createdAt),
              CURRENT_TIMESTAMP
            )
            """
        )
        normalize_datetime_column(conn, "Order", "updatedAt")

        conn.execute(
            """
            UPDATE "Order"
            SET settled = CASE
              WHEN LOWER(TRIM(CAST(settled AS TEXT))) IN ('1', 'true', 't', 'yes', 'y') THEN 1
              WHEN LOWER(TRIM(CAST(settled AS TEXT))) IN ('0', 'false', 'f', 'no', 'n') THEN 0
              ELSE 0
            END
            """
        )

        for field in ["rentStartDate", "deliveryTime", "actualDeliveryTime", "completedAt", "returnDeadline"]:
            normalize_datetime_column(conn, "Order", field)

    if "OnlineOrder" in tables:
        conn.execute(
            """
            UPDATE "OnlineOrder"
            SET createdAt = COALESCE(
              datetime(createdAt),
              datetime(rentStartDate),
              datetime(returnDeadline),
              CURRENT_TIMESTAMP
            )
            """
        )
        normalize_datetime_column(conn, "OnlineOrder", "createdAt")

        conn.execute(
            """
            UPDATE "OnlineOrder"
            SET updatedAt = COALESCE(
              datetime(updatedAt),
              datetime(createdAt),
              CURRENT_TIMESTAMP
            )
            """
        )
        normalize_datetime_column(conn, "OnlineOrder", "updatedAt")

        for field in ["rentStartDate", "returnDeadline"]:
            normalize_datetime_column(conn, "OnlineOrder", field)
        cleanup_online_order_noise(conn)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--data-dir", required=True)
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    data_dir = Path(args.data_dir).resolve()
    if not db_path.exists():
        raise FileNotFoundError(f"数据库不存在: {db_path}")
    if not data_dir.exists():
        raise FileNotFoundError(f"数据目录不存在: {data_dir}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    tx_active = False
    try:
        all_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        csv_files = sorted(data_dir.glob("*.csv"))
        table_to_csv: list[tuple[str, Path]] = []
        for file in csv_files:
            table_name = file.stem
            if table_name in all_tables:
                table_to_csv.append((table_name, file))

        if not table_to_csv:
            raise RuntimeError("没有发现可导入的 CSV 表")

        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        tx_active = True
        for table, _ in table_to_csv:
            conn.execute(f"DELETE FROM {qi(table)}")
        if "AppConfig" in all_tables:
            conn.execute(
                "DELETE FROM \"AppConfig\" WHERE key IN ('SPEC_PRODUCT_NAME_MAPPINGS', 'INVENTORY_ITEM_TYPE_PRODUCT_NAME_MAPPINGS')"
            )

        imported_result: list[tuple[str, int]] = []
        for table, csv_file in table_to_csv:
            imported = import_csv_to_table(conn, csv_file, table)
            imported_result.append((table, imported))
        ensure_missing_warehouses(conn, all_tables)
        nullify_invalid_optional_foreign_keys(conn, all_tables)
        repair_order_data(conn, all_tables)
        conn.execute("COMMIT")
        tx_active = False
        conn.execute("PRAGMA foreign_keys=ON")

        fk_issues = conn.execute("PRAGMA foreign_key_check").fetchall()
        if fk_issues:
            print("外键检查失败，示例：")
            for row in fk_issues[:20]:
                print(dict(row))
            raise RuntimeError(f"外键问题数量: {len(fk_issues)}")

        print("导入完成：")
        for table, count in imported_result:
            current_count = conn.execute(f"SELECT COUNT(*) FROM {qi(table)}").fetchone()[0]
            print(f"{table}: imported={count}, current={current_count}")
    except Exception:
        if tx_active:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"失败: {e}")
        sys.exit(1)
