/**
 * Reusable loading spinner component
 */

import React from 'react';
import { 
  Box, 
  CircularProgress, 
  Typography, 
  Backdrop 
} from '@mui/material';

const LoadingSpinner = ({ 
  message = 'Loading...', 
  size = 40, 
  fullScreen = false,
  overlay = false 
}) => {
  const content = (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={2}
      sx={{
        p: 3,
        ...(fullScreen && {
          minHeight: '50vh'
        })
      }}
    >
      <CircularProgress size={size} />
      {message && (
        <Typography 
          variant="body2" 
          color="text.secondary"
          textAlign="center"
        >
          {message}
        </Typography>
      )}
    </Box>
  );

  if (overlay) {
    return (
      <Backdrop
        sx={{ 
          color: '#fff', 
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backgroundColor: 'rgba(0, 0, 0, 0.5)'
        }}
        open={true}
      >
        {content}
      </Backdrop>
    );
  }

  return content;
};

export default LoadingSpinner;