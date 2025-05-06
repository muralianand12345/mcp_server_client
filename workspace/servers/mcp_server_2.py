import os
import psycopg2
from dotenv import load_dotenv
from typing import Optional
from mcp.server.fastmcp import FastMCP
from psycopg2.extras import RealDictCursor

load_dotenv()

mcp = FastMCP(
    "Postgres Search Service",
    instructions="Search and retrieve information from Postgres databases.",
    debug=False,
    log_level="INFO",
    port=8002,
)


def get_connection():
    return psycopg2.connect("postgresql://neondb_owner:npg_O32abLFEITNG@ep-bold-dawn-a1ru8bmh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require")


@mcp.tool()
def query(sql: str, parameters: Optional[list] = None) -> str:
    """
    Execute a SQL query and return the results.

    Args:
        sql: SQL query to be executed
        paramaters: Additional parameter for execution.
    """
    conn = None
    try:
        conn = get_connection()

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                if parameters:
                    query_string = cur.mogrify(sql, parameters).decode("utf-8")
                else:
                    query_string = sql

                cur.execute(query_string)

                if cur.description is None:
                    conn.commit()
                    return f"Query executed successfully, {cur.rowcount} rows affected."

                rows = cur.fetchall()
                if not rows:
                    return "No results found."

                result_lines = ["Results:", "--------"]
                for row in rows:
                    try:
                        line_items = []
                        for key, val in row.items():
                            if val is None:
                                formatted_val = "NULL"
                            elif isinstance(val, (bytes, bytearray)):
                                formatted_val = val.decode("utf-8", errors="replace")
                            else:
                                formatted_val = str(val).replace("%", "%%")

                            line_items.append(f"{key}: {formatted_val}")
                        result_lines.append(" | ".join(line_items))

                    except Exception as e:
                        result_lines.append(f"Error formatting row: {str(e)}")
                        continue

                return "\n".join(result_lines)

            except Exception as e:
                return f'Error running query \n"{sql}"\n\n {str(e)}'

    except Exception as e:
        return f"Connection error: {str(e)}"

    finally:
        if conn:
            conn.close()


@mcp.tool()
def list_schemas() -> str:
    """List all the schemas in the database"""
    return query(
        "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name"
    )


@mcp.tool()
def list_tables(db_schema: str = "public") -> str:
    """
    List all tables in a specific schema

    Args:
        db_schema: The schema name to list tables.
    """
    sql = """
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = %s
    ORDER BY table_name
    """
    return query(sql, [db_schema])


@mcp.tool()
def describe_table(table_name: str, db_schema: str = "public") -> str:
    """Get detailed information about a table.

    Args:
        table_name: The name of the table to describe
        db_schema: The schema name (defaults to 'public')
    """
    sql = """
    SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = %s AND table_name = %s
    ORDER BY ordinal_position
    """
    return query(sql, [db_schema, table_name])


@mcp.tool()
def get_foreign_keys(table_name: str, db_schema: str = "public") -> str:
    """Get foreign key information for a table.

    Args:
        table_name: The name of the table to get foreign keys from
        db_schema: The schema name (defaults to 'public')
    """
    sql = """
    SELECT 
        tc.constraint_name,
        kcu.column_name as fk_column,
        ccu.table_schema as referenced_schema,
        ccu.table_name as referenced_table,
        ccu.column_name as referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = %s
        AND tc.table_name = %s
    ORDER BY tc.constraint_name, kcu.ordinal_position
    """
    return query(sql, [db_schema, table_name])


@mcp.tool()
def find_relationships(table_name: str, db_schema: str = "public") -> str:
    """Find both explicit and implied relationships for a table.

    Args:
        table_name: The name of the table to analyze relationships for
        db_schema: The schema name (defaults to 'public')
    """
    try:
        fk_sql = """
        SELECT 
            kcu.column_name,
            ccu.table_name as foreign_table,
            ccu.column_name as foreign_column,
            'Explicit FK' as relationship_type,
            1 as confidence_level
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = %s
            AND tc.table_name = %s
        """

        implied_sql = """
        WITH source_columns AS (
            -- Get all ID-like columns from our table
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = %s 
            AND table_name = %s
            AND (
                column_name LIKE '%%id' 
                OR column_name LIKE '%%_id'
                OR column_name LIKE '%%_fk'
            )
        ),
        potential_references AS (
            -- Find tables that might be referenced by our ID columns
            SELECT DISTINCT
                sc.column_name as source_column,
                sc.data_type as source_type,
                t.table_name as target_table,
                c.column_name as target_column,
                c.data_type as target_type,
                CASE
                    -- Highest confidence: column matches table_id pattern and types match
                    WHEN sc.column_name = t.table_name || '_id' 
                        AND sc.data_type = c.data_type THEN 2
                    -- High confidence: column ends with _id and types match
                    WHEN sc.column_name LIKE '%%_id' 
                        AND sc.data_type = c.data_type THEN 3
                    -- Medium confidence: column contains table name and types match
                    WHEN sc.column_name LIKE '%%' || t.table_name || '%%'
                        AND sc.data_type = c.data_type THEN 4
                    -- Lower confidence: column ends with id and types match
                    WHEN sc.column_name LIKE '%%id'
                        AND sc.data_type = c.data_type THEN 5
                END as confidence_level
            FROM source_columns sc
            CROSS JOIN information_schema.tables t
            JOIN information_schema.columns c 
                ON c.table_schema = t.table_schema 
                AND c.table_name = t.table_name
                AND (c.column_name = 'id' OR c.column_name = sc.column_name)
            WHERE t.table_schema = %s
                AND t.table_name != %s  -- Exclude self-references
        )
        SELECT 
            source_column as column_name,
            target_table as foreign_table,
            target_column as foreign_column,
            CASE 
                WHEN confidence_level = 2 THEN 'Strong implied relationship (exact match)'
                WHEN confidence_level = 3 THEN 'Strong implied relationship (_id pattern)'
                WHEN confidence_level = 4 THEN 'Likely implied relationship (name match)'
                ELSE 'Possible implied relationship'
            END as relationship_type,
            confidence_level
        FROM potential_references
        WHERE confidence_level IS NOT NULL
        ORDER BY confidence_level, source_column;
        """

        fk_results = query(fk_sql, [db_schema, table_name])
        implied_results = query(
            implied_sql, [db_schema, table_name, db_schema, table_name]
        )

        if fk_results == "No results found" and implied_results == "No results found":
            return "No relationships found for this table"

        return f"Explicit Foreign Keys:\n{fk_results}\n\nImplied Relationships:\n{implied_results}"

    except Exception as e:
        return f"Error finding relationships: {str(e)}"


if __name__ == "__main__":
    mcp.run(transport="sse")
