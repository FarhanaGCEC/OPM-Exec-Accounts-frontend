# GCEC Account System

A modern web application for managing GCEC account transactions, credit cards, payments, and financial records built with React, TypeScript, and Vite.

## Features

- Bank Transaction Management
- Credit Card Details & Payments
- Credit Card Statements
- Post-Dated Cheques (PDC) Management
- Payables & Receivables Categories
- Payment Matching
- Dashboard with Analytics

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (version 16.x or higher)
- **Yarn** (package manager)

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd GCEC-Account
```

### 2. Install Dependencies

```bash
yarn install
```

### 3. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
VITE_API_BASE_URL=http://localhost:3000/api
```



### 4. Start the Development Server

```bash
yarn dev
```


### 5. Build for Production

```bash
yarn build
```

The production build will be created in the `dist` directory.

### 6. Preview Production Build

```bash
yarn preview
```

## Available Scripts

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn preview` - Preview production build
- `yarn lint` - Run ESLint

## Project Structure

```
GCEC-Account/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Page components
│   ├── services/       # API service functions
│   ├── lib/            # Utility functions and API wrapper
│   └── assets/         # Static assets
├── public/             # Public assets
└── dist/               # Production build output
```

## Technology Stack

- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **React Router** - Routing
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **Axios** - HTTP client
- **Tailwind CSS** - Styling
- **Radix UI** - Accessible UI components
- **Lucide React** - Icons

## API Configuration

The application uses a centralized API wrapper located at `src/lib/api.ts`. 

- Authentication token is automatically added from `localStorage.getItem('authToken')`
- Base URL can be configured via `VITE_API_BASE_URL` environment variable
- Default API base URL: `http://localhost:3000/api`

For detailed API usage, see [API_USAGE.md](./API_USAGE.md).

## Authentication

The application uses token-based authentication. After successful login, the token is stored in `localStorage` and automatically included in all API requests.

## Troubleshooting

### Port Already in Use
If port 5173 is already in use, Vite will automatically use the next available port.

### API Connection Issues
- Verify your `.env` file has the correct `VITE_API_BASE_URL`
- Ensure the backend server is running
- Check browser console for CORS errors

### Dependencies Issues
If you encounter dependency issues, try:
```bash
rm -rf node_modules yarn.lock
yarn install
```

## License

[Add your license information here]

