import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2563eb', foreground: '#ffffff' },
        secondary: { DEFAULT: '#f1f5f9', foreground: '#1e293b' },
        accent: { DEFAULT: '#0ea5e9', foreground: '#ffffff' },
        destructive: { DEFAULT: '#ef4444', foreground: '#ffffff' },
        muted: { DEFAULT: '#f8fafc', foreground: '#64748b' },
        border: '#e2e8f0',
        ring: '#2563eb',
        background: '#ffffff',
        foreground: '#0f172a',
        up: '#ef4444',       // 주가 상승 (빨강)
        down: '#3b82f6',     // 주가 하락 (파랑)

        surface: v('sf-surface'),
        gray: {
          50: v('sf-gray-50'),
          100: v('sf-gray-100'),
          200: v('sf-gray-200'),
          300: v('sf-gray-300'),
          400: v('sf-gray-400'),
          500: v('sf-gray-500'),
          600: v('sf-gray-600'),
          700: v('sf-gray-700'),
          800: v('sf-gray-800'),
          900: v('sf-gray-900'),
        },
        blue: {
          50: v('sf-blue-50'),
          100: v('sf-blue-100'),
          200: v('sf-blue-200'),
          300: v('sf-blue-300'),
          400: v('sf-blue-400'),
          500: v('sf-blue-500'),
          600: v('sf-blue-600'),
          700: v('sf-blue-700'),
        },
        red: {
          50: v('sf-red-50'),
          100: v('sf-red-100'),
          200: v('sf-red-200'),
          400: v('sf-red-400'),
          500: v('sf-red-500'),
          600: v('sf-red-600'),
          700: v('sf-red-700'),
        },
        amber: {
          50: v('sf-amber-50'),
          100: v('sf-amber-100'),
          200: v('sf-amber-200'),
          300: v('sf-amber-300'),
          400: v('sf-amber-400'),
          500: v('sf-amber-500'),
          600: v('sf-amber-600'),
          700: v('sf-amber-700'),
          800: v('sf-amber-800'),
        },
        emerald: {
          50: v('sf-emerald-50'),
          100: v('sf-emerald-100'),
          200: v('sf-emerald-200'),
          400: v('sf-emerald-400'),
          600: v('sf-emerald-600'),
          700: v('sf-emerald-700'),
        },
        rose: {
          50: v('sf-rose-50'),
          100: v('sf-rose-100'),
          200: v('sf-rose-200'),
          300: v('sf-rose-300'),
          500: v('sf-rose-500'),
        },
        sky: {
          50: v('sf-sky-50'),
          100: v('sf-sky-100'),
          600: v('sf-sky-600'),
          700: v('sf-sky-700'),
        },
        green: {
          100: v('sf-green-100'),
          600: v('sf-green-600'),
          700: v('sf-green-700'),
        },
        yellow: {
          100: v('sf-yellow-100'),
          700: v('sf-yellow-700'),
        },
        purple: {
          50: v('sf-purple-50'),
          400: v('sf-purple-400'),
          700: v('sf-purple-700'),
        },
        pink: {
          400: v('sf-pink-400'),
        },
        orange: {
          400: v('sf-orange-400'),
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
