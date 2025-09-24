#!/bin/bash

# Excel Template Mapper - Startup Script

echo "🚀 Starting Excel Template Mapper..."

# Kill any existing processes
echo "🔧 Cleaning up existing processes..."
pkill -f "python.*manage.py.*runserver" 2>/dev/null || true
pkill -f "npm.*start" 2>/dev/null || true
sleep 2

# Start backend
echo "🔥 Starting Django backend on port 8001..."
cd backend
source venv/bin/activate
python manage.py runserver 0.0.0.0:8001 --noreload &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 5

# Start frontend  
echo "🎨 Starting React frontend on port 3001..."
cd frontend
BROWSER=none PORT=3001 npm start &
FRONTEND_PID=$!
cd ..

echo "✅ Application started!"
echo "📱 Frontend: http://localhost:3001"
echo "🔧 Backend: http://localhost:8001"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap 'echo "🛑 Stopping services..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT
wait