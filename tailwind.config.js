import flyonuiPlugin from 'flyonui/plugin';
import iconify from '@iconify/tailwind';

/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	plugins: [flyonuiPlugin, iconify]
};
