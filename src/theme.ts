import { useColorScheme } from 'react-native';

export const brand = {
    green: '#2E7D5B',
    greenLight: '#70A487',
    cream: '#F2EDD5',
    navy: '#2B304A',
};

export function useTheme() {
    const dark = useColorScheme() === 'dark';
    return {
        dark,
        background: dark ? '#14181F' : '#FFFFFF',
        surface: dark ? '#1E242E' : '#F4F7F5',
        border: dark ? '#2C3542' : '#DCE5E0',
        text: dark ? brand.cream : brand.navy,
        muted: dark ? '#A3AEB8' : '#5E6A75',
        primary: brand.green,
        onPrimary: brand.cream,
        danger: '#B3261E',
        onDanger: '#FFFFFF',
        /** Raised cards and the selected list row. */
        card: dark ? '#1E242E' : '#FFFFFF',
        selectedSurface: dark ? '#18281F' : '#F1F8F4',
        /** Soft brand tint, e.g. behind an icon. */
        primarySoft: dark ? '#1F3A2C' : '#E8F3ED',
        radioBorder: dark ? '#4B5563' : '#C5CDD3',
        /** Offline / caution banners. */
        warningSurface: dark ? '#4A3F1C' : '#F8EBC4',
        onWarning: dark ? brand.cream : brand.navy,
    };
}
