NODE_ENV=production
PORT=3001
MONGODB_URI=mongodb+srv://your-username:your-password@cluster0.xxxxx.mongodb.net/spybot?retryWrites=true&w=majority
# Get from MongoDB Atlas
# Or use local: mongodb://mongo:27017/spybot

JWT_SECRET=your_jwt_secret_key_here_change_to_strong_random_min32_chars
# Generate with openssl rand -base64 32

SCRAPING_MODE=live
SCRAPING_URL=https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx
