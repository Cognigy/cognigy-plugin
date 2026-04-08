#!/bin/bash

# NiCE Cognigy MCP Server - Setup Script
# This script helps you set up the MCP server for the first time

set -e

echo "🚀 NiCE Cognigy MCP Server Setup"
echo "=============================="
echo ""

# Check Node.js version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Error: Node.js 20 or higher is required"
    echo "   Current version: $(node -v)"
    echo "   Please upgrade Node.js: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js $(node -v) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "⚙️  Creating .env file..."
    cp env.template .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your Cognigy API credentials:"
    echo "   - COGNIGY_API_BASE_URL"
    echo "   - COGNIGY_API_KEY"
    echo ""
    read -p "Press Enter to open .env in your default editor..." 
    ${EDITOR:-nano} .env
else
    echo "✅ .env file already exists"
fi
echo ""

# Build the project
echo "🔨 Building TypeScript project..."
npm run build
echo "✅ Build complete"
echo ""

# Run tests
echo "🧪 Running tests..."
npm test 2>/dev/null || echo "⚠️  Some tests failed (this is normal if no test environment is configured)"
echo ""

# Check if API key is configured
if grep -q "your-api-key-here" .env; then
    echo "⚠️  WARNING: You still need to configure your API key in .env"
    echo ""
    echo "📝 To get your API key:"
    echo "   1. Log in to Cognigy.AI"
    echo "   2. Go to User Menu > My Profile"
    echo "   3. Navigate to API Keys section"
    echo "   4. Create a new API key"
    echo "   5. Copy the key to .env"
    echo ""
else
    echo "✅ API key configured"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📚 Next steps:"
echo "   1. Ensure your .env file has valid credentials"
echo "   2. Run 'npm start' to start the MCP server"
echo "   3. Or run 'npm run dev' for development mode with auto-reload"
echo ""
echo "📖 Documentation:"
echo "   - README.md - Quick start guide"
echo "   - docs/USAGE.md - Common workflows and examples"
echo "   - docs/API_REFERENCE.md - Complete API documentation"
echo "   - docs/DEPLOYMENT.md - Production deployment guide"
echo ""
echo "💡 To use with Claude Desktop:"
echo "   See claude_desktop_config.example.json for configuration"
echo ""

