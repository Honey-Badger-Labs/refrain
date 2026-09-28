# The MelodyFlow songbook, as text

MelodyFlow writes a song as note tokens for a 13-note C-major steel tongue drum:

```js
L('Twinkle, twinkle, little star','1 1 5 5 | 6 6 5*2')
```

The first argument is a label on the line. For a singable song it happens to be the
lyric, but a label is sized to a musical phrase, so what MelodyFlow holds is a fragment
— one verse, one chorus, or in Scarborough Fair's case half a line. MelodyFlow chose
these songs; it did not supply these words.

The melody does not come across either. Refrain's render path takes words, not tunes,
so these are sung to a Refrain preset like any other chunk and the arrangements stay
where they are.

## The wording is not verified yet

**Read this before rendering anything here.** The lines were written out from common
knowledge, not copied from an edition. The container this was prepared in reaches
package registries and GitHub and nothing else, so Wikisource and Project Gutenberg
were both unreachable.

The rights position is not in doubt — every one of these is comfortably out of
copyright. The exact wording is. Traditional songs vary by region and by decade, and
Principle 1 says these lines are the truth and the audio is only a render, so a line
that is nearly right is a bug and not a rounding error.

Check each against the source below, then replace this section with what you found.

| Song | Check against |
| --- | --- |
| Twinkle, Twinkle, Little Star | Jane Taylor, *Rhymes for the Nursery* (1806), "The Star" |
| Old MacDonald Had a Farm | *Tommy's Tunes* (1917), where it appears as "Ohio" |
| Frère Jacques | Any 18th-century French round collection |
| Jingle Bells | James Lord Pierpont, "One Horse Open Sleigh" (1857) |
| When the Saints Go Marching In | Traditional; Katharine Purvis / James M. Black (1896) is the usual printed ancestor |
| Scarborough Fair | Child Ballad 2, "The Elfin Knight" |
| Amazing Grace | John Newton, *Olney Hymns* (1779), "Faith's Review and Expectation" |

## The register

Kept in MelodyFlow's own form, because the reason a song is absent is worth as much as
the ones that came.

| Song | | Why |
| --- | --- | --- |
| Twinkle, Twinkle, Little Star | **in** | Arrived whole from MelodyFlow; first verse, unchanged. |
| Old MacDonald Had a Farm | **completed** | MelodyFlow stopped after the cow. Extended to the full verse. |
| Frère Jacques | **completed** | MelodyFlow had the round in half-length shape; both repeats restored. |
| Jingle Bells | **completed** | MelodyFlow had the chorus only. Verse one added before it. |
| When the Saints Go Marching In | **completed** | MelodyFlow's four labels were phrase fragments of the same verse, one of them lower-case mid-sentence. Written as the verse it is. |
| Scarborough Fair | **completed** | MelodyFlow stopped at "Parsley, sage", mid-line. Full first verse. |
| Amazing Grace | **completed** | MelodyFlow had the first half of verse one. Verses one and two. |
| Ode to Joy | **out** | No words anywhere: its labels are structural — "Rising phrase", "and back down", "home on 1". Nothing to sing. |
| Hedwig's Theme | **out** | In copyright (John Williams, 2001). |
| Terminator theme | **out** | In copyright (Brad Fiedel, 1984). |
| Low Rider | **out** | In copyright (War, 1975). |
| Can't Help Falling in Love | **out** | In copyright (Peretti, Creatore and Weiss, 1961). |
| Somewhere in My Memory | **out** | In copyright (John Williams, 1990). |

The five copyright exclusions are a difference in what the two apps *do*, not a
difference of opinion about the songs. MelodyFlow synthesises notes in a browser for
someone practising alone and publishes nothing. Refrain renders audio and puts it on a
public site. MelodyFlow's own register weighs only whether a tune fits thirteen notes,
which is the right question there and not the only question here.
