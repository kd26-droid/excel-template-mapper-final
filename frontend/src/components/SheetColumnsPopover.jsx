import React, { useState } from 'react';
import { Box, Button, IconButton, InputAdornment, Popover, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

export default function SheetColumnsPopover({
  anchor, onClose, columns, visibleColumnKeys, activeFrozenSet, toggleFreezeColumn,
  onShowAll, onResetPins, onToggleColumn, tableTone,
}) {
  const [columnPopoverSearch, setColumnPopoverSearch] = useState('');
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={() => {
        onClose();
        setColumnPopoverSearch('');
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{
        sx: {
          mt: 0.5,
          width: { xs: 'min(310px, calc(100vw - 24px))', sm: 310 },
          maxHeight: 'min(520px, calc(100vh - 32px))',
          borderRadius: '14px',
          border: `1px solid ${tableTone.headerBorder}`,
          bgcolor: tableTone.isDark ? '#181a20' : '#ffffff',
          boxShadow: tableTone.isDark
            ? '0 20px 44px -16px rgba(0,0,0,0.65)'
            : '0 20px 44px -16px rgba(15,23,42,0.22)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      {(() => {
        const q = columnPopoverSearch.trim().toLowerCase();
        const filteredCols = q
          ? columns.filter((col) => String(col.label).toLowerCase().includes(q))
          : columns;
        const hiddenCount = Math.max(0, columns.length - visibleColumnKeys.length);
        return (
          <Box>
            {/* Header */}
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 2, py: 1.4, borderBottom: `1px solid ${tableTone.headerBorder}` }}
            >
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: tableTone.text }}>
                Columns
              </Typography>
              <Button
                size="small"
                onClick={() => onShowAll()}
                disabled={hiddenCount === 0}
                sx={{
                  minWidth: 0,
                  p: 0,
                  textTransform: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: '#007aff',
                  '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                }}
              >
                Show all
              </Button>
            </Stack>

            {/* Search */}
            <Box sx={{ px: 1.75, pt: 1.25, pb: 0.75 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search columns"
                value={columnPopoverSearch}
                onChange={(event) => setColumnPopoverSearch(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 16, color: tableTone.muted }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    height: 36,
                    borderRadius: '10px',
                    fontSize: 12.75,
                    bgcolor: tableTone.isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc',
                  },
                }}
              />
            </Box>

            {/* Column rows */}
            <Box sx={{ minHeight: 0, maxHeight: 'min(310px, calc(100vh - 220px))', overflowY: 'auto', overscrollBehavior: 'contain', px: 1, pb: 1 }}>
              {!filteredCols.length && <Typography sx={{ p: 1, fontSize: 13, color: tableTone.muted }}>No matching columns</Typography>}
              {filteredCols.map((column) => {
                const isVisible = visibleColumnKeys.includes(column.key);
                const isFrozen = activeFrozenSet.has(column.key);
                return (
                  <Stack
                    key={column.key}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    gap={1}
                    sx={{
                      px: 1,
                      py: 0.65,
                      borderRadius: '8px',
                      '&:hover': {
                        bgcolor: tableTone.isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc',
                      },
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 13,
                        fontWeight: isVisible ? 500 : 400,
                        color: isVisible ? tableTone.text : tableTone.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {column.label}
                    </Typography>
                    <Stack direction="row" alignItems="center" gap={0.75} flexShrink={0}>
                      <Switch
                        size="small"
                        checked={isVisible}
                        inputProps={{ 'aria-label': column.label }}
                        onChange={() => {
                          onToggleColumn(column.key);
                        }}
                        sx={{
                          width: 38,
                          height: 22,
                          p: 0,
                          '& .MuiSwitch-switchBase': {
                            p: '2px',
                            '&.Mui-checked': {
                              transform: 'translateX(16px)',
                              color: '#ffffff',
                              '& + .MuiSwitch-track': {
                                bgcolor: '#22c55e',
                                opacity: 1,
                              },
                            },
                          },
                          '& .MuiSwitch-thumb': {
                            width: 18,
                            height: 18,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          },
                          '& .MuiSwitch-track': {
                            borderRadius: '999px',
                            bgcolor: tableTone.isDark ? '#334155' : '#cbd5e1',
                            opacity: 1,
                          },
                        }}
                      />
                      <Tooltip title={isFrozen ? 'Unfreeze column' : 'Freeze column'} arrow>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!isVisible}
                            aria-label={`${isFrozen ? 'Unfreeze' : 'Freeze'} ${column.label}`}
                            onClick={() => toggleFreezeColumn(column.key)}
                            sx={{
                              width: 28,
                              height: 28,
                              borderRadius: '999px',
                              bgcolor: isFrozen ? '#007aff' : 'transparent',
                              color: isFrozen
                                ? '#ffffff'
                                : isVisible
                                  ? '#007aff'
                                  : tableTone.muted,
                              opacity: isVisible ? 1 : 0.35,
                              '&:hover': {
                                bgcolor: isFrozen
                                  ? '#0066d6'
                                  : (tableTone.isDark ? 'rgba(0,122,255,0.16)' : '#eff6ff'),
                              },
                            }}
                          >
                            <Box
                              component="svg"
                              viewBox="0 0 24 24"
                              sx={{
                                width: 14,
                                height: 14,
                                fill: isFrozen ? 'currentColor' : 'none',
                                stroke: 'currentColor',
                                strokeWidth: 2,
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                              }}
                            >
                              <path d="M12 17v5" />
                              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                            </Box>
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Stack>
                );
              })}
            </Box>

            {/* Footer */}
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                px: 1.75,
                py: 1.1,
                borderTop: `1px solid ${tableTone.headerBorder}`,
                bgcolor: tableTone.isDark ? 'rgba(255,255,255,0.02)' : '#fafbfd',
              }}
            >
              <Button
                size="small"
                onClick={() => {
                  onShowAll();
                  onResetPins();
                  setColumnPopoverSearch('');
                }}
                sx={{
                  textTransform: 'none',
                  fontSize: 12.25,
                  fontWeight: 500,
                  color: tableTone.muted,
                  '&:hover': { color: tableTone.text, bgcolor: 'transparent' },
                }}
              >
                ↺ Reset view
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  onClose();
                  setColumnPopoverSearch('');
                }}
                sx={{
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontSize: 12.25,
                  fontWeight: 500,
                  borderColor: tableTone.headerBorder,
                  color: tableTone.text,
                }}
              >
                Done
              </Button>
            </Stack>
          </Box>
        );
      })()}
    </Popover>
  );
}
