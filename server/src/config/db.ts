import mongoose from 'mongoose';

class DatabaseManager {
    static async connect() {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI!);
            console.log(`MongoDB connected: ${conn.connection.host}`);
        } catch (error: any) {
            console.error('MongoDB connection error:', error.message);
        }
    }

    static async disconnect() {
        await mongoose.disconnect();
    }
}

const db = {
    connect: DatabaseManager.connect,
    disconnect: DatabaseManager.disconnect,
}

export default db;