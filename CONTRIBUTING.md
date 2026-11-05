# Contributing to MCP Google Health Server

Thank you for your interest in contributing to the MCP Google Health Server! This project acts as a 1:1 JSON proxy to the Google Health API, providing AI assistants with access to health data.

## 🎯 Project Philosophy

This MCP server is designed to be:
- **Simple and focused** - Direct proxy to Google Health API without abstraction layers
- **Local development tool** - Not intended as a production service
- **Minimal complexity** - Easy to understand and maintain
- **API faithful** - Tools match Google Health API parameters exactly

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- NPM
- Google Cloud project with the Google Health API enabled ([developers.google.com/health](https://developers.google.com/health))

### Setup
1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Create `.env` file with your Fitbit app credentials:
   ```
   GOOGLE_HEALTH_CLIENT_ID=your_client_id
   GOOGLE_HEALTH_CLIENT_SECRET=your_client_secret
   ```
4. Build the project: `npm run build`
5. Test with MCP inspector: `npm run dev`

## 📝 Development Workflow

### Making Changes
1. Create a feature branch from `main`
2. Make your changes following our coding conventions
3. Run the full validation suite:
   ```powershell
   npm run build
   npm run test:coverage
   npm run lint
   ```
4. Test your changes with the MCP inspector (`npm run dev`)
5. Create a pull request

### Code Conventions

**TypeScript Standards:**
- Use TypeScript with ES modules
- Zod for parameter validation
- Prefer explicit types over `any`

**API Integration:**
- **Critical:** `makeGoogleHealthRequest` only prefixes `https://health.googleapis.com/v4/` - include `users/me/...` in paths (see `dataPointsPath()`)
- Tool parameters must exactly match Google Health API requirements
- Return raw JSON from Google Health API calls - no client-side data manipulation
- Check [Google Health API docs](https://developers.google.com/health) for proper endpoints

**Error Handling:**
- Use `console.error` for debugging information
- Let errors bubble up naturally - don't swallow them
- Provide meaningful error messages

**Testing:**
- Write unit tests for all new tools using Vitest
- Follow the pattern in existing `*.test.ts` files
- Mock `utils.js` functions (`registerTool`, `handleGoogleHealthCall`)
- Test tool registration, handler logic, error cases, and parameter validation

## 🧪 Testing

Run tests with:
```powershell
npm test                 # Run all tests
npm run test:coverage    # Run tests with coverage report
npm run test:ui          # Run tests with interactive UI
```

We aim for 80%+ test coverage. New features should include comprehensive tests.

## 🔍 Adding New Google Health Endpoints

When adding new Google Health API endpoints:

1. **Research the API first:** Check [Google Health API documentation](https://developers.google.com/health)
2. **Create the tool file:** Follow the pattern in existing tools (`src/weight.ts`, `src/sleep.ts`, etc.)
3. **Parameter validation:** Use Zod schemas that match Google Health API exactly
4. **Endpoint construction:** Remember `makeGoogleHealthRequest` adds `/user/-/` automatically
5. **Register the tool:** Add to `src/index.ts`
6. **Write tests:** Create corresponding `*.test.ts` file
7. **Update documentation:** Add tool description to README.md

### Example Tool Structure:
```typescript
import { z } from 'zod';
import { registerTool, handleGoogleHealthCall } from './utils.js';

const GetDataSchema = z.object({
  date: z.string().describe('Date in YYYY-MM-DD format'),
  period: z.enum(['1d', '7d', '30d']).optional()
});

registerTool({
  name: 'get_data',
  description: 'Get data from Google Health API',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      period: { type: 'string', enum: ['1d', '7d', '30d'] }
    },
    required: ['date']
  }
}, async (args) => {
  const { date, period = '1d' } = GetDataSchema.parse(args);
  const endpoint = `data/date/${date}/${period}.json`;
  return handleGoogleHealthCall(endpoint);
});
```

## 📚 Documentation

- Update README.md for new features
- Add JSDoc comments for complex functions
- Update this CONTRIBUTING.md if development processes change
- Keep TASKS.md updated with completed items

## 🐛 Bug Reports

When reporting bugs:
- Include steps to reproduce
- Provide error messages and logs
- Mention your environment (Node.js version, OS)
- Test with `npm run dev` to see if it reproduces in the MCP inspector

## 💡 Feature Requests

For new features:
- Check existing issues first
- Explain the use case and benefit
- Consider if it fits the project's simple, focused philosophy
- Reference specific Google Health API endpoints when applicable

## 📋 Pull Request Guidelines

- Use clear, descriptive commit messages
- Keep PRs focused on a single feature/fix
- Include tests for new functionality
- Update documentation as needed
- Ensure all CI checks pass

## 🔧 Development Commands

```powershell
npm run build         # Compile TypeScript
npm run start         # Run the built server
npm run dev           # Build and run with MCP inspector
npm run lint          # Check code quality
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format code with Prettier
npm run format:check  # Check code formatting
npm test              # Run tests
npm run test:coverage # Run tests with coverage
```

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

Feel free to open an issue for questions about contributing or the codebase.

---

Thank you for helping make the MCP Google Health Server better! 🎉
