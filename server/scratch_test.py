def simulate(stream_states):
    lastProcessedText = ""
    output = ""
    for state in stream_states:
        fullText = state # .rstrip() is what we are proposing
        # print("State:", repr(fullText))
        if len(fullText) > len(lastProcessedText) and fullText.startswith(lastProcessedText):
            chunk = fullText[len(lastProcessedText):]
            lastProcessedText = fullText
            output += chunk
        elif len(fullText) > 0 and not fullText.startswith(lastProcessedText):
            i = 0
            while i < len(fullText) and i < len(lastProcessedText) and fullText[i] == lastProcessedText[i]:
                i += 1
            chunk = fullText[i:]
            if len(chunk) > 0:
                lastProcessedText = fullText[:i] + chunk
                output += chunk
    return output

print("Without rstrip:")
stream = [
    "childre\n\n",
    "children\n\n"
]
print(repr(simulate(stream)))

print("With rstrip:")
stream2 = [
    "childre\n\n".rstrip(),
    "children\n\n".rstrip()
]
print(repr(simulate(stream2)))

print("With legitimate paragraph:")
stream3 = [
    "childre\n\n".rstrip(),
    "children\n\n".rstrip(),
    "children\n\nHe".rstrip()
]
print(repr(simulate(stream3)))
