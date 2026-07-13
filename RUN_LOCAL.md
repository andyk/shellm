## Server

mlx_lm.server --model mlx-community/Qwen3.5-0.8B-4bit  --host 0.0.0.0 --port 8090 --chat-template-args '{"enable_thinking": false}'

## Shellm
ipconfig getifaddr en0 

echo 'think_model=mlx-community/Qwen3.5-0.8B-4bit' >> .identities/localnick/info.txt

cat > .identities/localnick/.env <<'EOF'
SHELLM_API_URL=http://192.168.1.7:8090/v1/chat/completions
LLM_API_URL=http://192.168.1.7:8090/v1/chat/completions
OPENROUTER_API_KEY=local-qwen
EOF


## Smoke test
identity shell localnick
LLM_API_URL=http://192.168.1.7:8090/v1/chat/completions OPENROUTER_API_KEY=x ./bin/llm -m mlx-community/Qwen3.5-0.8B-4bit "say hello"


./bin/llm -m mlx-community/Qwen3.5-0.8B-4bit "say hello"


