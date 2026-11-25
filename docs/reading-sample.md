# Reading sample for a pull request

## A narrow column

A reviewer reading on a laptop can keep the page list open while scanning a short paragraph. With the window at the same width, increase the font to 20 px and find the place where the final sentence breaks. The last phrase is **under the station clock**.

## Three layouts to compare

| Page width | Focus | Landmark |
| --- | --- | --- |
| Default | Off | The gap beside the page list |
| Wide | Off | The last word on each line |
| Wide | On | The right edge of this table |

## A few lines with precise spacing

```json
{
  "width": "wide",
  "focus": false,
  "fontSize": 20
}
```

In **Files changed**, follow the indentation from the opening brace to the closing brace. Switch to **Conversation** and check the same font setting against the PR description.
