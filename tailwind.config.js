/** Konfigurasi Tailwind - build: npm run build:css */
module.exports = {
  content: ["./views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        primary: "#6184D6",
        "primary-dark": "#4B6BB5",
        "primary-light": "#8AA5E8",
        whatsapp: "#25D366",
        "whatsapp-dark": "#128C7E",
      },
    },
  },
  plugins: [],
};
