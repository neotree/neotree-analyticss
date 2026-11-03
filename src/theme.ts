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
    };
}
