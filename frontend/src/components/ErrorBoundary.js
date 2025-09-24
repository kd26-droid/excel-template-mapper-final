/**
 * Error Boundary component to catch and handle React errors gracefully
 */

import React from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  Container, 
  Alert,
  AlertTitle 
} from '@mui/material';
import { RefreshIcon } from '@mui/icons-material';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error
    console.error('Error Boundary caught an error:', error, errorInfo);
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });

    // You can also log the error to an error reporting service here
    if (process.env.NODE_ENV === 'production') {
      // Log to error reporting service
      // logErrorToService(error, errorInfo);
    }
  }

  handleReload = () => {
    // Clear error state and reload
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleReset = () => {
    // Just clear the error state
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Container maxWidth="md" sx={{ py: 8 }}>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            textAlign="center"
            gap={3}
          >
            <Alert severity="error" sx={{ width: '100%' }}>
              <AlertTitle>Oops! Something went wrong</AlertTitle>
              An unexpected error occurred. This has been logged and we'll look into it.
            </Alert>

            <Typography variant="h4" component="h1" gutterBottom>
              Application Error
            </Typography>

            <Typography variant="body1" color="text.secondary" paragraph>
              We apologize for the inconvenience. The application encountered an unexpected error.
              Please try refreshing the page or contact support if the problem persists.
            </Typography>

            <Box display="flex" gap={2} flexWrap="wrap" justifyContent="center">
              <Button
                variant="contained"
                color="primary"
                onClick={this.handleReload}
                startIcon={<RefreshIcon />}
                size="large"
              >
                Reload Page
              </Button>
              
              <Button
                variant="outlined"
                onClick={this.handleReset}
                size="large"
              >
                Try Again
              </Button>
            </Box>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <Box
                sx={{
                  mt: 4,
                  p: 2,
                  backgroundColor: '#f5f5f5',
                  borderRadius: 1,
                  width: '100%',
                  maxWidth: 800
                }}
              >
                <Typography variant="h6" gutterBottom>
                  Development Error Details:
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.875rem',
                    backgroundColor: '#fff',
                    p: 2,
                    borderRadius: 1,
                    border: '1px solid #ddd',
                    overflow: 'auto',
                    maxHeight: 300
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.errorInfo.componentStack}
                </Typography>
              </Box>
            )}
          </Box>
        </Container>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;