#!/bin/bash

# Test connection to Cognigy API
# This script verifies that your API credentials are working

set -e

echo "🔌 Testing Cognigy API Connection"
echo "=================================="
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "❌ Error: .env file not found"
    echo "   Run 'npm run setup' first"
    exit 1
fi

# Check if required variables are set
if [ -z "$COGNIGY_API_BASE_URL" ]; then
    echo "❌ Error: COGNIGY_API_BASE_URL not set in .env"
    exit 1
fi

if [ -z "$COGNIGY_API_KEY" ]; then
    echo "❌ Error: COGNIGY_API_KEY not set in .env"
    exit 1
fi

if [ "$COGNIGY_API_KEY" = "your-api-key-here" ]; then
    echo "❌ Error: API key not configured"
    echo "   Edit .env and add your actual API key"
    exit 1
fi

echo "📡 Testing connection to: $COGNIGY_API_BASE_URL"
echo ""

# Test API connection
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-API-Key: $COGNIGY_API_KEY" \
    -H "Accept: application/json" \
    "$COGNIGY_API_BASE_URL/v2.0/projects?limit=1")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Connection successful!"
    echo "   Status: $HTTP_STATUS OK"
    echo ""
    echo "🎉 Your API credentials are working correctly"
elif [ "$HTTP_STATUS" = "401" ]; then
    echo "❌ Authentication failed"
    echo "   Status: $HTTP_STATUS Unauthorized"
    echo ""
    echo "   Possible issues:"
    echo "   - Invalid API key"
    echo "   - Expired API key"
    echo "   - Wrong API key format"
    echo ""
    echo "   Please check your API key in .env"
    exit 1
elif [ "$HTTP_STATUS" = "403" ]; then
    echo "❌ Access forbidden"
    echo "   Status: $HTTP_STATUS Forbidden"
    echo ""
    echo "   Your API key doesn't have permission to access projects"
    echo "   Contact your Cognigy administrator"
    exit 1
else
    echo "❌ Connection failed"
    echo "   Status: $HTTP_STATUS"
    echo ""
    echo "   Possible issues:"
    echo "   - Network connectivity problems"
    echo "   - Incorrect API base URL"
    echo "   - Firewall blocking the connection"
    echo ""
    echo "   Current URL: $COGNIGY_API_BASE_URL"
    exit 1
fi

echo ""
echo "📊 Fetching account info..."
RESPONSE=$(curl -s \
    -H "X-API-Key: $COGNIGY_API_KEY" \
    -H "Accept: application/json" \
    "$COGNIGY_API_BASE_URL/v2.0/projects?limit=1")

PROJECT_COUNT=$(echo "$RESPONSE" | grep -o '"total":[0-9]*' | grep -o '[0-9]*' || echo "unknown")
echo "   Total projects: $PROJECT_COUNT"
echo ""

echo "✅ All checks passed! Your MCP server is ready to use."
echo ""
echo "🚀 Start the server with: npm start"

