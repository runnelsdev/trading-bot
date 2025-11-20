# Fill Notification Testing Guide

Complete guide for testing fill notifications with various formats and edge cases.

---

## Quick Start

### 1. Run Automated Test Suite

```bash
node src/test-fill-notifications.js auto
```

This runs all test cases automatically and generates a report.

### 2. Interactive Testing Mode

```bash
node src/test-fill-notifications.js
```

Then use commands in Discord:
- `!test list` - Show all available tests
- `!test complete` - Run "complete" test case
- `!test all` - Run all tests
- `!custom` - Send custom fill JSON
- `!quit` - Exit

---

## Test Cases Included

### ✅ Happy Path Tests

**complete** - Full fill with all fields
```json
{
  "orderId": "TEST-COMPLETE-001",
  "symbol": "SPY",
  "action": "Buy to Open",
  "status": "Filled",
  "filledQuantity": 10,
  "fillPrice": 450.25,
  "instrumentType": "Equity Option",
  "strike": 450,
  "expiration": "2024-12-15",
  "optionType": "CALL",
  "fees": 0.50
}
```
**Expected:** ✅ Beautiful formatted embed with all details

---

**partial** - Partially filled order
```json
{
  "filledQuantity": 5,
  "totalQuantity": 10,
  "status": "Partially Filled"
}
```
**Expected:** ✅ Shows 5/10 quantity

---

**equity** - Stock (not options)
```json
{
  "symbol": "AAPL",
  "instrumentType": "Equity",
  "filledQuantity": 100,
  "fillPrice": 175.25
}
```
**Expected:** ✅ No option fields shown

---

### ⚠️ Edge Case Tests

**minimal** - Only required fields
```json
{
  "symbol": "TSLA",
  "action": "Buy to Open",
  "filledQuantity": 1,
  "fillPrice": 250.00
}
```
**Expected:** ✅ Fills in defaults for missing fields

---

**missingSymbol** - No symbol field
```json
{
  "orderId": "TEST-001",
  "action": "Buy to Open",
  "fillPrice": 100.00
}
```
**Expected:** ❌ Critical validation error, no broadcast

---

**missingAction** - No action field
```json
{
  "symbol": "SPY",
  "fillPrice": 450.00
}
```
**Expected:** ❌ Critical validation error, no broadcast

---

**malformedTypes** - Wrong data types
```json
{
  "filledQuantity": "not-a-number",
  "fillPrice": "invalid-price",
  "filledAt": "not-a-date"
}
```
**Expected:** ⚠️ Sanitized to valid values (0, 0, current date)

---

**nullFields** - Null/undefined values
```json
{
  "symbol": null,
  "action": undefined,
  "fillPrice": null
}
```
**Expected:** ⚠️ Handled gracefully, shows "Unknown" for missing

---

**negativeNumbers** - Negative quantities/prices
```json
{
  "filledQuantity": -10,
  "fillPrice": -50.00
}
```
**Expected:** ⚠️ Converted to absolute values

---

**actionVariations** - Different action formats
```json
{
  "action": "BTO"  // vs "Buy to Open"
}
```
**Expected:** ✅ Normalized to "Buy to Open"

---

**emptyStrings** - Empty string fields
```json
{
  "symbol": "",
  "action": ""
}
```
**Expected:** ❌ Treated as missing, validation fails

---

**longSymbol** - Full OCC option symbol
```json
{
  "symbol": "SPXW241220C04500000"
}
```
**Expected:** ✅ Handles long symbols correctly

---

**specialChars** - Special characters
```json
{
  "symbol": "SPY/QQQ"
}
```
**Expected:** ✅ Sanitized but may show oddly

---

**multiLeg** - Spread with multiple legs
```json
{
  "legs": [
    { "strike": 450, "action": "Buy to Open" },
    { "strike": 455, "action": "Sell to Open" }
  ]
}
```
**Expected:** ✅ Shows primary leg info

---

## Running Specific Tests

### Via CLI:
```bash
# Run one test
node src/test-fill-notifications.js complete

# Run multiple tests
node src/test-fill-notifications.js minimal malformedTypes
```

### Via Discord:
```
!test complete
!test malformedTypes
!test all
```

---

## Custom Testing

### Send Custom JSON:

In Discord, type:
```
!custom
```

Then send your JSON:
```json
{
  "symbol": "NVDA",
  "action": "Sell to Close",
  "filledQuantity": 50,
  "fillPrice": 500.75,
  "status": "Filled"
}
```

Bot will parse and broadcast it.

---

## Expected Validation Behavior

### Critical Fields (MUST have):
- `symbol` - Cannot be missing/empty
- `action` - Cannot be missing/empty

**If missing:** No broadcast, error returned

### Important Fields (should have):
- `filledQuantity` - Defaults to 0 if missing
- `fillPrice` - Defaults to 0 if missing
- `status` - Defaults to "Filled"

**If missing:** Warning logged, defaults used

### Optional Fields:
- `strike`, `expiration`, `optionType` - Only for options
- `fees`, `commission` - Financial details
- `accountNumber`, `executionVenue` - Metadata

**If missing:** Simply not shown in embed

---

## Testing Tastytrade Message Formats

### Format 1: Account Streamer Order Event
```javascript
{
  type: 'Order',
  data: {
    order: {
      id: '12345',
      'underlying-symbol': 'SPY',
      status: 'Filled',
      'filled-quantity': 10,
      'avg-fill-price': 450.25,
      legs: [{
        'instrument-type': 'Equity Option',
        action: 'Buy to Open',
        'strike-price': 450,
        'expiration-date': '2024-12-15',
        'option-type': 'CALL'
      }]
    }
  }
}
```

### Format 2: Fill Event
```javascript
{
  type: 'Fill',
  data: {
    'order-id': '12345',
    symbol: 'SPY',
    quantity: 10,
    price: 450.25,
    action: 'Buy to Open',
    'executed-at': '2024-11-20T10:30:00Z'
  }
}
```

### Format 3: Simplified
```javascript
{
  orderId: '12345',
  symbol: 'SPY',
  filledQuantity: 10,
  fillPrice: 450.25,
  action: 'Buy to Open',
  status: 'Filled'
}
```

**Test all three formats** to ensure parsing works.

---

## Debugging Failed Tests

### Check Validation Errors:

Validation results are included in response:
```javascript
{
  validation: {
    isValid: false,
    critical: true,
    errors: ['Missing symbol', 'Missing action']
  }
}
```

### Check Sanitization:

Before/after comparison:
```javascript
// Before
{ filledQuantity: "10", fillPrice: "-50" }

// After sanitization
{ filledQuantity: 10, fillPrice: 50 }
```

### Check Console Logs:

Look for:
- `⚠️  Invalid fill data: ...` - Validation warning
- `⚠️  Proceeding with sanitized fill data` - Using defaults
- `❌ Critical validation failed` - Won't broadcast

---

## Manual Testing Checklist

### Basic Functionality:
- [ ] Complete fill broadcasts to all tiers
- [ ] Partial fill shows correct quantity (X/Y)
- [ ] Buy orders show green, Sell orders show red
- [ ] Options show strike/expiration/type
- [ ] Equity orders don't show option fields
- [ ] Fees/commission calculate correctly
- [ ] Account number is masked (****1234)

### Validation:
- [ ] Missing symbol → No broadcast
- [ ] Missing action → No broadcast
- [ ] Missing price → Uses 0
- [ ] Missing quantity → Uses 0
- [ ] Negative numbers → Converted to positive
- [ ] String numbers → Converted to numbers
- [ ] Invalid dates → Uses current date

### Tier Filtering:
- [ ] VIP gets all fills
- [ ] Premium gets major symbols
- [ ] Basic gets most major only
- [ ] Fills match original signal tiers

### Error Handling:
- [ ] Malformed JSON → Caught and logged
- [ ] Missing Discord channel → Error logged, continues
- [ ] API errors → Graceful failure

---

## Continuous Testing

### Add to CI/CD:

```bash
# In your GitHub Actions / CI pipeline
- name: Test Fill Notifications
  run: node src/test-fill-notifications.js auto
```

### Monitor in Production:

```javascript
// Log validation failures
if (!validation.isValid) {
  await logToDatabase({
    type: 'validation_failure',
    errors: validation.errors,
    fillData: fill
  });
}
```

---

## Performance Testing

### Load Test:

Send 100 fills rapidly:
```bash
for i in {1..100}; do
  node src/test-fill-notifications.js complete &
done
```

**Check:**
- [ ] All broadcasts succeed
- [ ] No rate limit errors
- [ ] Discord API doesn't throttle
- [ ] Memory doesn't leak

---

## Reporting Issues

When reporting a test failure, include:

1. **Test name** - Which test failed
2. **Input data** - Fill object that was sent
3. **Expected behavior** - What should happen
4. **Actual behavior** - What actually happened
5. **Error logs** - Console output
6. **Validation result** - `validation` object from response

---

## Summary

**Test Suite Features:**
✅ 15+ edge case scenarios  
✅ Automated and interactive modes  
✅ Validation and sanitization testing  
✅ Custom JSON input support  
✅ Detailed error reporting  
✅ Tier filtering verification  

**Run tests before:**
- Deploying to production
- Making changes to fill-broadcaster.js
- Updating Tastytrade integration
- Adding new tier filters

**All tests passing = Production ready!** 🚀
