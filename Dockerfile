FROM node:18-bullseye

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Create necessary directories
RUN mkdir -p uploads public/processed

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]