/** @type {import('tailwindcss').Config} */
export default {
  // CRÍTICO: Estas rutas le dicen a Tailwind que busque clases en todos los archivos JS/JSX/TSX dentro de 'src'
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

