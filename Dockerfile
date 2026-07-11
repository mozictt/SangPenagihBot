# Menggunakan image Node.js v24 resmi versi ringan (Alpine)
FROM node:24-alpine

# Tentukan working directory di dalam container
WORKDIR /app

# Copy package.json dan package-lock.json terlebih dahulu untuk efisiensi cache Docker
COPY package*.json ./

# Install dependency secara clean (production-ready)
RUN npm ci --only=production

# Copy seluruh source code project ke dalam container
COPY . .

# Buat file database default kosong agar tidak crash saat pertama running jika belum ada
RUN echo '{"users": [], "schedules": {}}' > database_v2.json

# Jalankan aplikasi
CMD ["node", "index.js"]