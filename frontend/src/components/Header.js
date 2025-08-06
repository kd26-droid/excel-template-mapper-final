import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import TableChartIcon from '@mui/icons-material/TableChart';

const Header = () => {
  return (
    <AppBar position="static">
      <Toolbar>
        <TableChartIcon sx={{ mr: 2 }} />
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          Excel Template Mapper - Azure Production
        </Typography>
        <Box>
          <Button 
            color="inherit" 
            component={RouterLink} 
            to="/"
          >
            Dashboard
          </Button>
          <Button 
            color="inherit" 
            component={RouterLink} 
            to="/upload"
          >
            Upload Files
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;