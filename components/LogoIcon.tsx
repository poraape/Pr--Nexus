import React from 'react';

type IconProps = {
  className?: string;
};

const LogoIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Nexus QuantumI2A2 Logo"
  >
    <defs>
      <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#38bdf8' }} />
        <stop offset="100%" style={{ stopColor: '#2dd4bf' }} />
      </linearGradient>
    </defs>
    {/* Stylized 'N' shape */}
    <path
      d="M 20 80 L 20 20 L 80 80 L 80 20"
      stroke="url(#logoGradient)"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* Bar chart elements inside the 'N' */}
    <rect x="35" y="45" width="10" height="35" fill="url(#logoGradient)" rx="3" />
    <rect x="55" y="25" width="10" height="55" fill="url(#logoGradient)" rx="3" />
  </svg>
);

export default LogoIcon;
