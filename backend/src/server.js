require('dotenv').config();
const http=require('http');const mongoose=require('mongoose');const {Server}=require('socket.io');const app=require('./app');
const server=http.createServer(app);const io=new Server(server,{cors:{origin:(process.env.CORS_ORIGIN||'http://localhost:5173').split(',')}});app.set('io',io);
const port=Number(process.env.PORT||5000);
async function start(){await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/smart-building');server.listen(port,()=>console.log(`Smart Building API listening on ${port} (SIMULATED BUILDING)`));}
async function shutdown(){await mongoose.disconnect();server.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
start().catch(e=>{console.error(e);process.exit(1)});
