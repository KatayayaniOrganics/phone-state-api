FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application files
COPY phone_state_api_fast.js .
COPY enhanced_prefix_state.json .

# Cloud Run uses PORT environment variable
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Start the application with optimizations
CMD ["node", "--max-old-space-size=512", "phone_state_api_fast.js"]
