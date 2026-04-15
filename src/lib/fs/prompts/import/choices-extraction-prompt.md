Generate the world state and decisions that the player can make based on the context of my next message.

If the message already contains decisions, choices, or options, use them and do not generate new ones.

Respond using the following JSON format only:

```json
{
  "worldState": "[Briefly detail secret background information, hidden character motives, or hidden plot tracking here. Do not show player-facing narrative yet.]",
  "decisions": [
    "[choice 1 text]",
    "[choice 2 text]",
    "[choice 3 text]",
    "[choice 4 text]"
  ]
}
```
