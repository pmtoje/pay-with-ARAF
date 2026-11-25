/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@araf/design-tokens/tailwind-preset')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
