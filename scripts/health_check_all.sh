#!/bin/bash

echo "Checking Python AI Module..."
curl -s http://localhost:8000/health || echo "Python module not reachable"
echo ""
echo "Checking Express Backend..."
curl -s http://localhost:3000/sessions/active || echo "Backend not reachable"
echo ""
