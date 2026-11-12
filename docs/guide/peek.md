# Peek

A result bigger than `peek.maxBytes` (default 8192 bytes of text) comes back as a preview instead of the whole payload:

```
shape: array[10000] of {user_id:number,name:string(5),country:string(2)}
first 5: [{"user_id":1,"name":"Ann 1","country":"DE"}, …]
(result is 412345 bytes; full value: pipe__get {"handle":"c7.out"})
saved as {{ c7.out }}
```

The full value is stored. The AI can pass it on by ref (`{{ c7.out }}`), read a slice (`pipe__get {"handle":"c7.out[100]"}` or with `jq`), or fetch it whole.

- Images and other binary content are never peeked.
- `"peek": { "maxBytes": 0 }` in `servers.json` turns peek off.
