import os
import psycopg2
from dotenv import load_dotenv
from typing import Optional, List
from mcp.server.fastmcp import FastMCP
from psycopg2.extras import RealDictCursor

load_dotenv()

mcp = FastMCP(
    "PGVector RAG Service",
    instructions="Search and retrieve information from Postgres PGVector database.",
    debug=False,
    log_level="INFO",
    port=8003,
)


def get_connection(conn_string: Optional[str] = None) -> psycopg2.extensions.connection:
    conn_string = conn_string or os.getenv("POSTGRES_URL")
    return psycopg2.connect()


PGVECTOR_SIMILARITY_QUERY = """
SELECT id, ticket_id, subject, description, customer, metadata, resolution, created_at FROM public.{TABLE_NAME}
ORDER BY embedding <=> $1::vector 
LIMIT $2;
"""


@mcp.tool()
def pgvector_search(
    embedding: List[float],
    top_k: int = 5,
    conn_string: Optional[str] = None,
    table_name: str = "vector_tables",
) -> List[dict]:
    """
    Search for similar support tickets in the PGVector database.

    Args:
        query (str): The query string to search for.
        top_k (int): The number of top results to return.
        conn_string (Optional[str]): Optional connection string to connect to the database.

    Returns:
        list[dict]: A list of dictionaries containing the search results.
    """
    conn = None
    try:
        conn = get_connection(conn_string)

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                cur.execute(PGVECTOR_SIMILARITY_QUERY.format(TABLE_NAME=table_name), (embedding, top_k))
                results = cur.fetchall()
                return results
            except psycopg2.Error as e:
                print(f"Error executing query: {e}")
                return []

    except psycopg2.Error as e:
        print(f"Error connecting to the database: {e}")
        return []
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    mcp.run(transport="sse")
