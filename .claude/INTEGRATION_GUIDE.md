# MPN Database Integration Guide

This guide explains how to integrate the MPN Database into your existing project.

## 📋 Database Overview

**Current Database Location:** `/Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3`

**Database Stats:**
- **6,948,822 components** (clean data)
- **32,544 manufacturers** 
- **2,173 categories**

## 🗂️ Database Schema

### Tables

#### `components`
- `lcsc` (INTEGER) - LCSC part number (primary key)
- `mfr` (TEXT) - Manufacturer part number (MPN)
- `manufacturer_id` (INTEGER) - Foreign key to manufacturers table
- `package` (TEXT) - Component package type
- `description` (TEXT) - Component description
- `stock` (INTEGER) - Available stock
- `price` (TEXT) - JSON pricing tiers
- `category_id` (INTEGER) - Foreign key to categories table
- `datasheet` (TEXT) - Datasheet URL
- `basic` (INTEGER) - Basic part flag
- `joints` (INTEGER) - Number of pins/joints
- `last_update` (INTEGER) - Last update timestamp

#### `manufacturers`
- `id` (INTEGER) - Primary key
- `name` (TEXT) - Manufacturer name

#### `categories`
- `id` (INTEGER) - Primary key  
- `name` (TEXT) - Category name

## 🚀 Integration Options

### Option 1: Copy Database File

**Steps:**
1. Copy the SQLite database to your project:
   ```bash
   cp /Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3 /path/to/your/project/data/
   ```

2. Copy the query script:
   ```bash
   cp /Users/kartikd/Documents/GitHub/MPN_ML_Database/query_data.py /path/to/your/project/
   ```

3. Update the database path in your project:
   ```python
   DB_PATH = Path(__file__).parent / "data" / "cache.sqlite3"
   ```

### Option 2: Create Database Connection Module

Create a new file `mpn_database.py` in your project:

```python
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional

class MPNDatabase:
    def __init__(self, db_path: str = "/Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3"):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Database not found at {db_path}")
    
    def connect(self):
        """Get database connection"""
        return sqlite3.connect(self.db_path)
    
    def search_components(self, search_term: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search components by MPN or description"""
        conn = self.connect()
        try:
            query = """
            SELECT 
                c.lcsc,
                c.mfr as mpn,
                m.name as manufacturer,
                c.package,
                c.description,
                c.stock,
                c.price
            FROM components c
            JOIN manufacturers m ON c.manufacturer_id = m.id
            WHERE c.mfr LIKE ? OR c.description LIKE ?
            LIMIT ?
            """
            cursor = conn.cursor()
            cursor.execute(query, (f'%{search_term}%', f'%{search_term}%', limit))
            
            columns = ['lcsc', 'mpn', 'manufacturer', 'package', 'description', 'stock', 'price']
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            conn.close()
    
    def get_component_by_mpn(self, mpn: str) -> Optional[Dict[str, Any]]:
        """Get exact component by MPN"""
        conn = self.connect()
        try:
            query = """
            SELECT 
                c.lcsc,
                c.mfr as mpn,
                m.name as manufacturer,
                c.package,
                c.description,
                c.stock,
                c.price
            FROM components c
            JOIN manufacturers m ON c.manufacturer_id = m.id
            WHERE c.mfr = ?
            LIMIT 1
            """
            cursor = conn.cursor()
            cursor.execute(query, (mpn,))
            row = cursor.fetchone()
            
            if row:
                columns = ['lcsc', 'mpn', 'manufacturer', 'package', 'description', 'stock', 'price']
                return dict(zip(columns, row))
            return None
        finally:
            conn.close()
    
    def get_components_by_manufacturer(self, manufacturer_name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get components by manufacturer"""
        conn = self.connect()
        try:
            query = """
            SELECT 
                c.lcsc,
                c.mfr as mpn,
                m.name as manufacturer,
                c.package,
                c.description,
                c.stock,
                c.price
            FROM components c
            JOIN manufacturers m ON c.manufacturer_id = m.id
            WHERE m.name LIKE ?
            LIMIT ?
            """
            cursor = conn.cursor()
            cursor.execute(query, (f'%{manufacturer_name}%', limit))
            
            columns = ['lcsc', 'mpn', 'manufacturer', 'package', 'description', 'stock', 'price']
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            conn.close()
    
    def get_stats(self) -> Dict[str, int]:
        """Get database statistics"""
        conn = self.connect()
        try:
            cursor = conn.cursor()
            
            cursor.execute("SELECT COUNT(*) FROM components")
            component_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM manufacturers")
            manufacturer_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM categories")
            category_count = cursor.fetchone()[0]
            
            return {
                'components': component_count,
                'manufacturers': manufacturer_count,
                'categories': category_count
            }
        finally:
            conn.close()
    
    def validate_mpn(self, mpn: str) -> bool:
        """Simple MPN validation - checks if MPN exists in database"""
        component = self.get_component_by_mpn(mpn)
        return component is not None
```

### Option 3: Environment Variable Configuration

Create a configuration file `config.py`:

```python
import os
from pathlib import Path

# Database configuration
MPN_DATABASE_PATH = os.environ.get(
    'MPN_DATABASE_PATH', 
    '/Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3'
)

# Validate database exists
if not Path(MPN_DATABASE_PATH).exists():
    raise FileNotFoundError(f"MPN Database not found at {MPN_DATABASE_PATH}")

# Usage in your project
from config import MPN_DATABASE_PATH
import sqlite3

def get_mpn_connection():
    return sqlite3.connect(MPN_DATABASE_PATH)
```

## 📝 Usage Examples

### Basic Search

```python
from mpn_database import MPNDatabase

db = MPNDatabase()

# Search for components
results = db.search_components("TL072")
for component in results:
    print(f"MPN: {component['mpn']} - {component['manufacturer']}")

# Get exact component
component = db.get_component_by_mpn("TL072CN")
if component:
    print(f"Found: {component['description']}")

# Validate MPN
is_valid = db.validate_mpn("TL072CN")  # Returns True/False
```

### Flask/FastAPI Integration

```python
from flask import Flask, jsonify, request
from mpn_database import MPNDatabase

app = Flask(__name__)
db = MPNDatabase()

@app.route('/api/components/search')
def search_components():
    query = request.args.get('q', '')
    limit = int(request.args.get('limit', 10))
    
    results = db.search_components(query, limit)
    return jsonify(results)

@app.route('/api/components/<mpn>')
def get_component(mpn):
    component = db.get_component_by_mpn(mpn)
    if component:
        return jsonify(component)
    return jsonify({'error': 'Component not found'}), 404

@app.route('/api/validate/<mpn>')
def validate_mpn(mpn):
    is_valid = db.validate_mpn(mpn)
    return jsonify({'mpn': mpn, 'is_valid': is_valid})
```

### Django Integration

```python
# models.py
from django.db import models
from mpn_database import MPNDatabase

class ComponentValidation(models.Model):
    mpn = models.CharField(max_length=255)
    is_valid = models.BooleanField()
    validated_at = models.DateTimeField(auto_now_add=True)
    
    @classmethod
    def validate_mpn(cls, mpn):
        db = MPNDatabase()
        is_valid = db.validate_mpn(mpn)
        
        # Cache the result
        validation, created = cls.objects.get_or_create(
            mpn=mpn,
            defaults={'is_valid': is_valid}
        )
        
        return validation.is_valid

# views.py
from django.http import JsonResponse
from .models import ComponentValidation

def validate_mpn_view(request, mpn):
    is_valid = ComponentValidation.validate_mpn(mpn)
    return JsonResponse({'mpn': mpn, 'is_valid': is_valid})
```

## 🔧 Required Dependencies

Add to your `requirements.txt`:

```
sqlite3  # Built-in with Python
pathlib  # Built-in with Python
```

For CSV export functionality:
```
pandas>=1.3.0  # Optional, for advanced data manipulation
```

## 📊 Database Maintenance

### Regular Updates

The database can be updated by running the data acquisition script:

```bash
cd /Users/kartikd/Documents/GitHub/MPN_ML_Database
python3 scripts/data_processing/data_acquisition.py
```

### Backup Strategy

```bash
# Create backup
cp /Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3 /path/to/backup/mpn_database_$(date +%Y%m%d).sqlite3

# Verify backup
sqlite3 /path/to/backup/mpn_database_$(date +%Y%m%d).sqlite3 "SELECT COUNT(*) FROM components;"
```

## 🔍 Advanced Queries

### Custom SQL Queries

```python
def advanced_search(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Advanced component search with filters"""
    conn = self.connect()
    try:
        conditions = []
        params = []
        
        if filters.get('manufacturer'):
            conditions.append("m.name LIKE ?")
            params.append(f"%{filters['manufacturer']}%")
        
        if filters.get('package'):
            conditions.append("c.package LIKE ?")
            params.append(f"%{filters['package']}%")
        
        if filters.get('in_stock'):
            conditions.append("c.stock > 0")
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        query = f"""
        SELECT 
            c.lcsc,
            c.mfr as mpn,
            m.name as manufacturer,
            c.package,
            c.description,
            c.stock,
            c.price
        FROM components c
        JOIN manufacturers m ON c.manufacturer_id = m.id
        WHERE {where_clause}
        LIMIT ?
        """
        
        params.append(filters.get('limit', 10))
        
        cursor = conn.cursor()
        cursor.execute(query, params)
        
        columns = ['lcsc', 'mpn', 'manufacturer', 'package', 'description', 'stock', 'price']
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        conn.close()
```

## 📈 Performance Optimization

### Database Indexes

The database includes optimized indexes for:
- MPN searches
- Manufacturer lookups
- Category filtering
- Stock availability

### Connection Pooling

For high-traffic applications:

```python
import sqlite3
from contextlib import contextmanager
from threading import Lock

class MPNDatabasePool:
    def __init__(self, db_path: str, max_connections: int = 10):
        self.db_path = db_path
        self.max_connections = max_connections
        self.connections = []
        self.lock = Lock()
    
    @contextmanager
    def get_connection(self):
        with self.lock:
            if self.connections:
                conn = self.connections.pop()
            else:
                conn = sqlite3.connect(self.db_path)
        
        try:
            yield conn
        finally:
            with self.lock:
                if len(self.connections) < self.max_connections:
                    self.connections.append(conn)
                else:
                    conn.close()
```

## 🚨 Error Handling

```python
class MPNDatabaseError(Exception):
    """Custom exception for MPN database errors"""
    pass

class MPNDatabase:
    def search_components(self, search_term: str, limit: int = 10) -> List[Dict[str, Any]]:
        if not search_term.strip():
            raise MPNDatabaseError("Search term cannot be empty")
        
        try:
            conn = self.connect()
            # ... query logic ...
        except sqlite3.Error as e:
            raise MPNDatabaseError(f"Database error: {str(e)}")
        except Exception as e:
            raise MPNDatabaseError(f"Unexpected error: {str(e)}")
        finally:
            if 'conn' in locals():
                conn.close()
```

## 📚 Integration Checklist

- [ ] Copy database file to your project
- [ ] Copy or create database connection module
- [ ] Update file paths in configuration
- [ ] Test database connectivity
- [ ] Implement error handling
- [ ] Add logging for database operations
- [ ] Set up backup strategy
- [ ] Document API endpoints (if applicable)
- [ ] Add unit tests for database operations
- [ ] Configure monitoring/alerts

## 🔗 Related Files

- **Database File**: `/Users/kartikd/Documents/GitHub/MPN_ML_Database/data/cache.sqlite3`
- **Query Script**: `/Users/kartikd/Documents/GitHub/MPN_ML_Database/query_data.py`
- **Docker Config**: `/Users/kartikd/Documents/GitHub/MPN_ML_Database/docker-compose.dev.yml`
- **Init SQL**: `/Users/kartikd/Documents/GitHub/MPN_ML_Database/init-db/init.sql`
- **Project README**: `/Users/kartikd/Documents/GitHub/MPN_ML_Database/README.md`

## 📞 Support

For issues or questions regarding the MPN database integration, refer to:
- Project documentation in `/Users/kartikd/Documents/GitHub/MPN_ML_Database/README.md`
- Database schema in `/Users/kartikd/Documents/GitHub/MPN_ML_Database/init-db/init.sql`
- Sample queries in `/Users/kartikd/Documents/GitHub/MPN_ML_Database/query_data.py`