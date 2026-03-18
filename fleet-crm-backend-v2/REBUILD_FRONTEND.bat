@echo off
title Rebuild Frontend
color 0E
echo.
echo  Rebuilding frontend...
echo  (Run this whenever you update the frontend code)
echo.
cd ..\fleet-crm-frontend
npm run build
echo.
echo  Done! Restart the CRM server to see changes.
pause
