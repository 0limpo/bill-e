import React from 'react';
import { getAvatarColor, getInitials } from '../../utils/billEngine';

const Avatar = ({ name, size = 'medium', className = '' }) => (
  <div
    className={`avatar ${className}`}
    style={{
      backgroundColor: getAvatarColor(name || ''),
      width: size === 'small' ? '28px' : '40px',
      height: size === 'small' ? '28px' : '40px',
      fontSize: size === 'small' ? '12px' : '14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      color: 'white',
      fontWeight: 'bold',
      flexShrink: 0
    }}
  >
    {getInitials(name)}
  </div>
);

export default Avatar;
