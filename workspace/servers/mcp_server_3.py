import os
from openai import OpenAI
import psycopg2
from dotenv import load_dotenv
from typing import List, Optional, Union
from mcp.server.fastmcp import FastMCP

load_dotenv()

mcp = FastMCP(
    "PGVector RAG Vector Similarity Search",
    instructions="Search and retrieve information from AWS S3 buckets.",
    debug=False,
    log_level="INFO",
    port=8003,
)


class RAG:
    def __init__(
        self,
        conn_string: Optional[str] = os.getenv("POSTGRES_URI"),
        openai_api_key: Optional[str] = os.getenv("OPENAI_API_KEY"),
        openai_base_url: Optional[str] = os.getenv("OPENAI_BASE_URL"),
    ):

        self.conn = psycopg2.connect(conn_string)
        self.openai_client = OpenAI(api_key=openai_api_key, base_url=openai_base_url)
        self.rag_query = """
            SELECT * FROM public.{table_name}
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        """

    def _generate_embedding(
        self, text: str, embedding_model: str = "text-embedding-3-large"
    ) -> List[float]:
        text = text.replace("\n", " ")
        return (
            self.openai_client.embeddings.create(input=[text], model=embedding_model)
            .data[0]
            .embedding
        )

    def _execute_query(
        self,
        sql: str,
        embeddings: List[str],
        topK: Union[int, None],
        parameters: Optional[List] = None,
    ) -> List[dict]:
        with self.conn.cursor() as cursor:
            if parameters:
                query_string = cursor.mogrify(sql, parameters).decode("utf-8")
            else:
                query_string = sql

            cursor.execute(query_string, (embeddings, topK))

            if cursor.description is None:
                raise Exception("No results found.")

            return cursor.fetchall()

    def search(
        self,
        text: str,
        table_name: Optional[str] = "vector_table",
        top_k: Optional[int] = 5,
    ) -> List[dict]:

        embeddings = self._generate_embedding(text)
        sql_query = self.rag_query.format(table_name=table_name)
        results = self._execute_query(sql_query, embeddings, top_k)

        return [dict(row) for row in results]


@mcp.tool()
def rag_search(
    query: str,
    conn_string: Optional[str] = None,
    table_name: Optional[str] = "vector_table",
    openai_api_key: Optional[str] = None,
    openai_base_url: Optional[str] = None,
    top_k: Optional[int] = 5,
) -> List[dict]:
    """
    Perform a RAG (Retrieval-Augmented Generation) search using PGVector and OpenAI.

    Args:
        query: The search query string.
        conn_string: PostgreSQL connection string.
        table_name: Name of the table to search in.
        openai_api_key: OpenAI API key for embedding generation.
        openai_base_url: OpenAI base URL for API requests.
        top_k: Number of top results to return.

    Returns:
        List of dictionaries containing the search results.
    """
    try:
        rag = RAG(conn_string, openai_api_key, openai_base_url)
        results = rag.search(query, table_name, top_k)
        return results
    except Exception as e:
        raise Exception(f"Error performing RAG search: {str(e)}")
    finally:
        if rag.conn:
            rag.conn.close()
