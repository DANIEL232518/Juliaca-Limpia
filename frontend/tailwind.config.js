/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        sanroman: {
          azul: '#004B93',
          celeste: '#00AEEF',
          dorado: '#FDB913',
        },
        basura: {
          critica: '#D32F2F',
        },
        zona: {
          tratada: '#16A34A',
        },
        fondo: '#F8FAFC',
      },
      boxShadow: {
        card: '0 18px 40px -24px rgba(0, 75, 147, 0.45)',
        soft: '0 2px 12px rgba(15, 23, 42, 0.07)',
        pop: '0 24px 60px -20px rgba(2, 32, 71, 0.35)',
      },
      borderRadius: {
        '2.5xl': '1.35rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 280ms ease-out both',
      },
    },
  },
  plugins: [],
};
