import argparse
import sqlite3
from pathlib import Path


def normalize_datetime_column(conn: sqlite3.Connection, table: str, column: str):
    conn.execute(
        f"""
        UPDATE "{table}"
        SET "{column}" = CASE
          WHEN datetime("{column}") IS NULL THEN NULL
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ', datetime("{column}"))
        END
        WHERE "{column}" IS NOT NULL
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise FileNotFoundError(f"数据库不存在: {db_path}")

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("BEGIN")

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

        fixed_order_created = conn.execute(
            """
            SELECT COUNT(*) FROM "Order"
            WHERE createdAt IS NULL OR TRIM(CAST(createdAt AS TEXT)) = '' OR strftime('%s', createdAt) IS NULL
            """
        ).fetchone()[0]
        fixed_order_updated = conn.execute(
            """
            SELECT COUNT(*) FROM "Order"
            WHERE updatedAt IS NULL OR TRIM(CAST(updatedAt AS TEXT)) = '' OR strftime('%s', updatedAt) IS NULL
            """
        ).fetchone()[0]
        fixed_online_created = conn.execute(
            """
            SELECT COUNT(*) FROM "OnlineOrder"
            WHERE createdAt IS NULL OR TRIM(CAST(createdAt AS TEXT)) = '' OR strftime('%s', createdAt) IS NULL
            """
        ).fetchone()[0]
        fixed_online_updated = conn.execute(
            """
            SELECT COUNT(*) FROM "OnlineOrder"
            WHERE updatedAt IS NULL OR TRIM(CAST(updatedAt AS TEXT)) = '' OR strftime('%s', updatedAt) IS NULL
            """
        ).fetchone()[0]

        conn.execute("COMMIT")

        print("修复完成")
        print(
            f"remaining_invalid: order.createdAt={fixed_order_created}, order.updatedAt={fixed_order_updated}, "
            f"online.createdAt={fixed_online_created}, online.updatedAt={fixed_online_updated}"
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
