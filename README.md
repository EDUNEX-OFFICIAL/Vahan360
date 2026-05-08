# 🚀 Spybot - Next.js Migration

Complete migration from Java Spring Boot to Node.js/Express + Next.js stack.

## 🏗️ Architecture

```
Frontend (Next.js)     Backend (Express)     Database (MongoDB)
    ↓                       ↓                       ↓
- React Components    - REST APIs           - Khanan Data
- Dashboard UI        - Puppeteer Scraping  - Vehicle Data
- Real-time Updates   - Data Processing     - Analytics
- Responsive Design   - Background Jobs
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- MongoDB Atlas account (or local MongoDB)

### Environment Setup
```bash
# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Update MongoDB URI in backend/.env
MONGODB_URI=mongodb+srv://your-connection-string
```

### Docker Deployment
```bash
# Build and run all services
docker-compose up --build

# Access the application
# Frontend: http://localhost
# Backend API: http://localhost/api
# Health Check: http://localhost/health
```

### Local Development
```bash
# Install dependencies from the root workspace
pnpm install

# Start both frontend and backend in parallel
pnpm dev

# Or run services individually
pnpm --filter backend dev
pnpm --filter frontend dev

# MongoDB (if not using Docker)
mongod
```

## 📦 Monorepo / pnpm
- Root workspace is managed with `pnpm` and `turbo`
- Packages: `frontend`, `backend`
- Run shared commands from the repo root, e.g. `pnpm build` or `pnpm lint`

## 📊 API Endpoints

### Khanan Data
- `GET /api/khanan/data` - Get khanan records with filters
- `GET /api/khanan/stats` - Get statistics
- `GET /api/khanan/districts` - Get unique districts
- `GET /api/khanan/minerals` - Get unique minerals

### Vehicle Data
- `GET /api/vehicle/trip-summary` - Get vehicle trip summaries
- `POST /api/vehicle/trip-summary` - Create/update vehicle summary
- `GET /api/vehicle/stats` - Get vehicle statistics

### Scraping
- `GET /api/selenium/by-date-range` - Start scraping by date range
- `GET /api/selenium/status` - Get scraper status
- `GET /api/selenium/dailyScraping` - Trigger daily scraping

## 🔧 Configuration

### Scraping Modes
```env
# Live scraping from actual website
SCRAPING_MODE=live
SCRAPING_URL=https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx

# Local development with fake data
SCRAPING_MODE=local
SCRAPING_URL=local://khanan/epassreportAllDist
```

### Database
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/spybot
# or for local
MONGODB_URI=mongodb://localhost:27017/spybot
```

## 🐳 Docker Services

- **frontend**: Next.js application (Port 3000)
- **backend**: Express API with Puppeteer (Port 3001)
- **mongo**: MongoDB database (Port 27017)
- **nginx**: Reverse proxy (Port 80)

## 🔄 Migration Changes

### From Java Spring Boot
- ❌ Selenium WebDriver
- ❌ Spring Data MongoDB
- ❌ Java Controllers/Services

### To Node.js Stack
- ✅ Puppeteer (headless Chrome)
- ✅ Mongoose ODM
- ✅ Express routes with middleware
- ✅ Next.js with App Router
- ✅ TypeScript support

### Key Improvements
- 🚀 **Faster**: Node.js async performance
- 🐳 **Containerized**: Full Docker support
- 📱 **Modern UI**: Next.js with Tailwind CSS
- 🔧 **Developer Experience**: Hot reload, TypeScript
- 📊 **Real-time**: Better dashboard with live updates

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Integration tests
npm run test:e2e
```

## 📈 Monitoring

- Health checks: `/health`
- Scraper status: `/api/selenium/status`
- Application logs: Docker logs
- MongoDB monitoring: MongoDB Atlas dashboard

## 🚀 Deployment

### Production Checklist
- [ ] Update MongoDB URI to production
- [ ] Set SCRAPING_MODE=live
- [ ] Configure SSL certificates
- [ ] Set up monitoring (PM2, Docker monitoring)
- [ ] Configure backup strategy
- [ ] Set up CI/CD pipeline

### Scaling
- Horizontal scaling with Docker Swarm/Kubernetes
- Redis for session management (if needed)
- CDN for static assets
- Database read replicas

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

## 📝 License

MIT License - see LICENSE file for details.

---

**Migration completed successfully! 🎉**

From Java monolith to modern Node.js microservices architecture.
# Vahan360
