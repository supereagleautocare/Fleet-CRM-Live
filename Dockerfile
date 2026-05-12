FROM node:22-alpine

WORKDIR /app

# Install backend dependencies
COPY fleet-crm-backend-v2/package*.json ./fleet-crm-backend-v2/
RUN cd fleet-crm-backend-v2 && npm ci --omit=dev

# Install frontend dependencies
COPY fleet-crm-frontend/package*.json ./fleet-crm-frontend/
RUN cd fleet-crm-frontend && npm install

# Copy all source files
COPY . .

# Build frontend → outputs to fleet-crm-backend-v2/public (admin.html copied from frontend/public/)
RUN cd fleet-crm-frontend && npm run build

EXPOSE 3001

CMD ["node", "fleet-crm-backend-v2/server.js"]
