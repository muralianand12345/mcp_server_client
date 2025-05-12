docker compose down

docker compose up -d postgres localstack
sleep 10
docker compose up -d mcp_server1 mcp_server2
sleep 10
docker compose up -d mcp_api
sleep 5
docker compose up -d mcp_streamlit