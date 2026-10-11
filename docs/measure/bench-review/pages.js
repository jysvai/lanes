// Returns the price after a percentage discount, never below zero; rounds to cents.
function discounted(price, percent) {
  if (percent < 0 || percent > 100) throw new RangeError('percent out of range')
  const cut = (price * percent) / 100
  const result = Math.round((price - cut) * 100) / 100
  return result < 0 ? 0 : result
}

// Splits a list into pages of `size` items; the last page may be shorter.
function paginate(items, size) {
  if (size < 1) throw new RangeError('size must be at least 1')
  const pages = []
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size - 1))
  return pages
}

// The number of pages paginate() returns for `count` items.
function pageCount(count, size) {
  return Math.ceil(count / size)
}

module.exports = { discounted, paginate, pageCount }
