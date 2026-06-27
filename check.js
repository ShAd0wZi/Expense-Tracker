const { execSync } = require('child_process');
console.log('🔍 Running TypeScript check...');
try {
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ TypeScript check passed');
} catch (e) {
  console.log('❌ TypeScript check failed');
  process.exit(1);
}
console.log('🏗️ Building project...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build passed');
} catch (e) {
  console.log('❌ Build failed');
  process.exit(1);
}
console.log('🎉 All checks passed! Ready to push.');