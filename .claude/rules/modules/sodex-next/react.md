---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "src/components/**/*"
---

# React Best Practices

## Component Structure
- Use functional components over class components
- Keep components small and focused
- Extract reusable logic into custom hooks
- Use composition over inheritance
- Implement proper prop types with TypeScript
- Split large components into smaller, focused ones

## Hooks
- Follow the Rules of Hooks
- Use custom hooks for reusable logic
- Keep hooks focused and simple
- Implement cleanup in useEffect when needed
- Avoid nested hooks
- **Early returns must come after all hooks**: never place `if (...) return` before any `useState`/`useEffect`/`useMemo`/`useCallback`/custom hook call — doing so makes hook call order unstable and causes runtime errors

### Timer Cleanup (Critical)
- Always store `setTimeout` / `setInterval` IDs in a `useRef` and clear them in `useEffect` cleanup to prevent execution after unmount
- When re-triggering, clear the previous timer before setting a new one to avoid parallel timers
- Timers inside `useCallback` / event handlers follow the same rule: store the ID in a `useRef`, clear previous before setting new, and clear on unmount via `useEffect` cleanup
- If the caller needs to wait for the timer to finish (e.g. to keep a loading state), wrap `setTimeout` in a `Promise` and `await` it — never fire-and-forget a `setTimeout` while a loading indicator depends on the callback completing

### useEffect Dependencies (Critical)
- Prefer primitive values (string/number/boolean) as dependencies
- Wrap objects/arrays with `useMemo` to stabilize reference
- Wrap functions with `useCallback` to stabilize reference
- Use `useRef` for values that shouldn't trigger re-run
- Avoid inline objects/arrays/functions in dependency array
- Goal: prevent unnecessary re-runs from unstable references; real value changes still trigger as expected

## State Management
- Use useState for local component state
- Implement useReducer for complex state logic
- Use Context API for shared state
- Keep state as close to where it's used as possible
- Avoid prop drilling through proper state management
- Use state management libraries only when necessary

## Performance
- Implement proper memoization (useMemo, useCallback)
- Use React.memo for expensive components
- Avoid unnecessary re-renders
- Implement proper lazy loading
- Use proper key props in lists
- Profile and optimize render performance

## Forms
- Use controlled components for form inputs
- Implement proper form validation
- Handle form submission states properly
- Show appropriate loading and error states
- Use form libraries for complex forms
- Implement proper accessibility for forms

## Error Handling
- Implement Error Boundaries
- Handle async errors properly
- Show user-friendly error messages
- Implement proper fallback UI
- Log errors appropriately
- Handle edge cases gracefully

## Testing
- Write unit tests for components
- Implement integration tests for complex flows
- Use React Testing Library
- Test user interactions
- Test error scenarios
- Implement proper mock data

## Accessibility
- Use semantic HTML elements
- Implement proper ARIA attributes
- Ensure keyboard navigation
- Test with screen readers
- Handle focus management
- Provide proper alt text for images

## Code Organization
- Group related components together
- Use proper file naming conventions
- Implement proper directory structure
- Keep styles close to components
- Use proper imports/exports
- Document complex component logic