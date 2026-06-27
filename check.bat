@echo off
echo 🔍 Running TypeScript check...
call npx tsc --noEmit
if errorlevel 1 (
  echo ❌ TypeScript errors found! Fix them before pushing.
  exit /b 1
)

echo 🏗️ Building project...
call npm run build
if errorlevel 1 (
  echo ❌ Build failed! Fix errors before pushing.
  exit /b 1
)

echo ✅ All checks passed! Ready to push.