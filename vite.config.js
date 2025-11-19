import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  
  // Explicitly defining the server configuration to prevent local connectivity issues
  server: {
    host: '0.0.0.0', // Allows access from network interfaces
    port: 5173,      // Default port for Vite
  },
});