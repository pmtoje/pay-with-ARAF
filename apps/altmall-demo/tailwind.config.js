/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
module.exports = {
  presets: [require('@araf/design-tokens/tailwind-preset')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mall: { DEFAULT: v('mall'), strong: v('mall-strong'), soft: v('mall-soft'), contrast: v('mall-contrast') },
      },
    },
  },
};
