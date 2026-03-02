FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY server.js ./

# Create directories
RUN mkdir -p /tmp/uploads /pages

# Expose port
EXPOSE 3001

# Environment variables (can be overridden)
ENV PORT=3001
ENV HESK_URL=http://your-server-ip:8140
ENV STATIC_DIR=/pages

# Start the server
CMD ["node", "server.js"]
