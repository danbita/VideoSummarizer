# Use Node.js 20 Alpine for smaller image size and OpenAI compatibility
FROM node:20-alpine

# Install ffmpeg and other required packages
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++

# Create app directory
WORKDIR /app

# Create necessary directories
RUN mkdir -p uploads output temp logs

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start the application
CMD ["npm", "start"]