import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  IconButton,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import { Close as CloseIcon, CloudUpload as CloudUploadIcon } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import FormulaBuilder from './FormulaBuilder';
import { useThemeContext } from '../utils/ThemeContext';

const StandaloneFormulaBuilder = ({ open, onClose, onSave }) => {
  const { isDarkMode, tokens: t } = useThemeContext();
  const [activeStep, setActiveStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formulaRules, setFormulaRules] = useState([]);
  const [factwiseFile, setFactwiseFile] = useState(null);
  const [factwiseColumns, setFactwiseColumns] = useState([]);
  const [columnExamples, setColumnExamples] = useState({});
  const [columnFillStats, setColumnFillStats] = useState({});

  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setFactwiseFile(file);

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

          if (sheetData.length > 1) {
            const originalHeaders = sheetData[0];
            const headers = originalHeaders.filter(h => h);
            const dataRows = sheetData.slice(1);
            const totalRows = dataRows.length;

            setFactwiseColumns(headers);

            const examples = {};
            const stats = {};
            headers.forEach((header) => {
              const originalIndex = originalHeaders.indexOf(header);

              // Find the first non-empty example for this column
              let firstExample = '';
              for (const row of dataRows) {
                const cellValue = row[originalIndex];
                if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
                  firstExample = cellValue;
                  break;
                }
              }
              examples[header] = firstExample;

              // Calculate fill stats
              let nonEmptyCount = 0;
              for (const row of dataRows) {
                const cellValue = row[originalIndex];
                if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
                  nonEmptyCount++;
                }
              }

              const fillPercentage = totalRows > 0 ? nonEmptyCount / totalRows : 0;
              if (fillPercentage === 0) {
                stats[header] = 'empty';
              } else if (fillPercentage < 0.8) {
                stats[header] = 'partial';
              } else {
                stats[header] = 'full';
              }
            });

            setColumnExamples(examples);
            setColumnFillStats(stats);
            console.log('Calculated Column Fill Stats:', stats);
          } else if (sheetData.length === 1) {
            const headers = sheetData[0].filter(h => h);
            setFactwiseColumns(headers);
            const examples = {};
            const stats = {};
            headers.forEach(header => {
              examples[header] = '';
              stats[header] = 'empty';
            });
            setColumnExamples(examples);
            setColumnFillStats(stats);
            console.log('Calculated Column Fill Stats (header only):', stats);
          }
        } catch (e) {
          console.error("Error parsing file", e);
          alert("Failed to parse the file. Please ensure it's a valid .xlsx, .xls, or .csv file.");
        }
      };
      reader.readAsBinaryString(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv']
    },
    maxFiles: 1
  });

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleSave = () => {
    if (!name) {
      alert('Template name is required.');
      return;
    }
    onSave({
      name,
      description,
      formula_rules: formulaRules,
    });
    // Reset state after saving
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setFormulaRules([]);
    setFactwiseFile(null);
    setFactwiseColumns([]);
    setActiveStep(0);
    onClose();
  };

  const handleFormulasApplied = (newRules) => {
    setFormulaRules(newRules);
  };

  const steps = ['Upload Factwise Template', 'Create Tag Rules'];

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          overflow: 'hidden',
          bgcolor: t.surface.elevated,
          border: `1px solid ${t.border.modal}`,
          color: t.text.primary,
        }
      }}
    >
      <DialogTitle sx={{ pr: 6, color: t.text.heading }}>
        Create New Tag Template
        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: t.text.secondary,
            '&:hover': {
              color: t.text.primary,
              bgcolor: t.action.hover,
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: t.surface.elevated, color: t.text.primary }}>
        <Stepper
          activeStep={activeStep}
          sx={{
            my: 3,
            '& .MuiStepConnector-line': { borderColor: t.border.strong },
            '& .MuiStepLabel-label': { color: t.text.secondary, fontWeight: 600 },
            '& .MuiStepLabel-label.Mui-active, & .MuiStepLabel-label.Mui-completed': {
              color: t.text.primary,
            },
            '& .MuiStepIcon-root': {
              color: isDarkMode ? 'rgba(148, 163, 184, 0.7)' : '#cbd5e1',
            },
            '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': {
              color: t.color.primary,
            },
          }}
        >
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 && (
          <Box sx={{ my: 2 }}>
            <Typography variant="h6" sx={{ mb: 2, color: t.text.heading }}>Upload Factwise Template</Typography>
            <Box
              {...getRootProps()}
              sx={{
                border: `1.5px dashed ${isDragActive ? t.border.focus : t.border.strong}`,
                borderRadius: '14px',
                p: { xs: 3, sm: 4.5 },
                minHeight: 150,
                textAlign: 'center',
                cursor: 'pointer',
                background: factwiseFile
                  ? t.dropzone.selected
                  : (isDragActive ? t.dropzone.active : t.dropzone.background),
                color: t.text.primary,
                transition: 'all 0.2s ease',
                boxShadow: isDarkMode
                  ? 'inset 0 1px 0 rgba(255,255,255,0.06)'
                  : '0 10px 26px rgba(15,23,42,0.06)',
                '&:hover': {
                  borderColor: t.color.primaryLight,
                  background: t.dropzone.active,
                }
              }}
            >
              <input {...getInputProps()} />
              <CloudUploadIcon sx={{ fontSize: 42, color: t.color.primaryLight }} />
              <Typography variant="body1" sx={{ mt: 2, color: t.text.primary, fontWeight: 650 }}>
                {factwiseFile ? factwiseFile.name : 'Drop your Factwise template (Excel or CSV) here or click to browse'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: t.text.secondary }}>
                Supported: .xlsx, .xls, .csv
              </Typography>
            </Box>
            {factwiseFile && (
              <Typography variant="body2" sx={{ mt: 2, color: t.color.success }}>
                ✓ Selected: {factwiseFile.name} ({factwiseColumns.length} columns found)
              </Typography>
            )}
          </Box>
        )}

        {activeStep === 1 && (
          <>
            <Box sx={{ my: 2 }}>
              <TextField
                autoFocus
                margin="dense"
                id="name"
                label="Template Name"
                type="text"
                fullWidth
                variant="outlined"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <TextField
                margin="dense"
                id="description"
                label="Description"
                type="text"
                fullWidth
                multiline
                rows={2}
                variant="outlined"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Box>
            <Typography variant="h6" sx={{ mt: 2, mb: 1, color: t.text.heading }}>
              Smart Tag Rules
            </Typography>
            <FormulaBuilder
              open={true}
              onClose={handleClose}
              sessionId="standalone"
              availableColumns={factwiseColumns}
              columnExamples={columnExamples}
              columnFillStats={columnFillStats}
              onApplyFormulas={handleFormulasApplied}
              initialRules={formulaRules}
              templateMode={true}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: t.surface.footer, borderTop: `1px solid ${t.border.subtle}` }}>
        <Button onClick={handleClose} sx={{ color: t.color.primarySoftText }}>Cancel</Button>
        <Box sx={{ flex: '1 1 auto' }} />
        {activeStep > 0 && (
          <Button onClick={handleBack} sx={{ color: t.text.secondary }}>
            Back
          </Button>
        )}
        {activeStep < steps.length - 1 ? (
          <Button onClick={handleNext} variant="contained" disabled={!factwiseFile} sx={{ px: 3, minHeight: 38 }}>
            Next
          </Button>
        ) : (
          <Button onClick={handleSave} variant="contained" disabled={!name} sx={{ px: 3, minHeight: 38 }}>
            Save Template
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default StandaloneFormulaBuilder;
