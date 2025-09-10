#!/bin/bash

echo "🚀 Setting up Video Key Moments project..."

# Create directory structure
echo "📁 Creating directories..."
mkdir -p src input output temp public

# Create .gitkeep files to maintain empty directories
touch input/.gitkeep
touch output/.gitkeep
touch temp/.gitkeep

echo "📝 Creating package.json..."
cat > package.json << 'EOF'
{
  "name": "video-key-moments",
  "version": "1.0.0",
  "description": "Intelligent video summarization tool that extracts key moments from screen recordings",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "node src/test-ffmpeg.js",
    "docker:build": "docker build -t video-key-moments .",
    "docker:run": "docker run -it --rm -v $(pwd)/input:/app/input -v $(pwd)/output:/app/output video-key-moments",
    "docker:dev": "docker-compose up --build"
  },
  "keywords": [
    "video",
    "ai",
    "ffmpeg",
    "summarization",
    "screen-recording"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "fluent-ffmpeg": "^2.1.2",
    "openai": "^4.20.1",
    "fs-extra": "^11.1.1",
    "path": "^0.12.7",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
EOF

echo "🐳 Creating Dockerfile..."
cat > Dockerfile << 'EOF'
# Use Node.js LTS version
FROM node:18-bullseye

# Install ffmpeg and other dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Verify ffmpeg installation
RUN ffmpeg -version

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application code
COPY . .

# Create input and output directories
RUN mkdir -p input output temp

# Expose port for web interface (optional)
EXPOSE 3000

# Default command
CMD ["npm", "start"]
EOF

echo "🐳 Creating docker-compose.yml..."
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  video-processor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./input:/app/input
      - ./output:/app/output
      - ./temp:/app/temp
      - ./src:/app/src
    environment:
      - NODE_ENV=development
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    command: npm run dev
EOF

echo "⚙️ Creating .env file..."
cat > .env << 'EOF'
# API Keys (replace with your actual keys)
OPENAI_API_KEY=your_openai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# Environment
NODE_ENV=development
EOF

echo "🙈 Creating .gitignore..."
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.production

# Video files and processing directories
input/*.mp4
input/*.mov
input/*.avi
output/*
temp/*

# Keep directory structure but ignore contents
!input/.gitkeep
!output/.gitkeep  
!temp/.gitkeep

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# Docker
.dockerignore

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Temporary files
*.tmp
*.temp
EOF

echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file with your API keys"
echo "2. Run: npm run docker:dev"
echo "3. Test: npm run test"
echo ""
echo "🌐 The app will be available at: http://localhost:3000"
